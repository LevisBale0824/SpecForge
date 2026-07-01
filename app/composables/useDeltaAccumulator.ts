// ---------------------------------------------------------------------------
// Streaming Delta Accumulator
// ---------------------------------------------------------------------------
// Accumulates message.part.delta SSE events into full message parts.
// Uses a module-level Map so the state persists across component instances.
// Ported from opencode-visualizer-cn/app/composables/useDeltaAccumulator.ts
// ---------------------------------------------------------------------------

import type {
  MessageInfo,
  MessagePart,
  MessagePartDeltaPacket,
  MessagePartRemovedPacket,
  MessagePartUpdatedPacket,
  MessageUpdatedPacket,
} from "../types/sse";

type GlobalEvents = {
  on(event: string, listener: (payload: unknown) => void): () => void;
};

export type AccumulatedMessage = {
  info: MessageInfo;
  parts: Map<string, MessagePart>;
};

// Module-level singleton store
const messages = new Map<string, AccumulatedMessage>();

// Tracks how many chars each part has accumulated via `message.part.delta`.
// Used to detect duplicate deltas that arrive after a `part.updated`
// snapshot has already incorporated their text — without this check, the
// snapshot + late delta combination appends the same content twice.
// Keyed by `${messageID}:${partID}`.
const deltaLens = new Map<string, number>();

// Remembers the last delta payload seen per `${messageID}:${partID}:${field}`.
// Drops a delta that is byte-identical to the immediately preceding one for
// the same field — replay paths occasionally re-emit the same chunk, and the
// lens check can't catch it when no snapshot has landed in between. Assumes
// the stream never legitimately sends the same payload twice in a row (true
// for LLM token streams). Keyed by `${lensKey}:${field}`.
const lastDeltaContent = new Map<string, string>();
function lensKey(messageID: string, partID: string): string {
  return `${messageID}:${partID}`;
}

// Longest common prefix length of two strings. Used to re-baseline the delta
// lens when a `part.updated` snapshot forks from the accumulated text — i.e.
// the snapshot neither extends nor truncates the existing text but diverges
// mid-stream. The lens is valid only as far as the new snapshot agrees with
// the old text, so we collapse it to the LCP.
function longestCommonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function isComplete(info: MessageInfo): boolean {
  if (info.role !== "assistant") return true;
  if (info.error) return true;
  if (info.time?.completed !== undefined) return true;
  if (info.finish) return true;
  return false;
}

export function useDeltaAccumulator() {
  function listen(ge: GlobalEvents): () => void {
    const offs: Array<() => void> = [];

    offs.push(
      ge.on("message.updated", (packet: unknown) => {
        const { info } = packet as MessageUpdatedPacket;
        if (isComplete(info)) {
          messages.delete(info.id);
          // Drop delta-lens entries for this message's parts so they don't
          // leak across message-id reuse or reconnect replays.
          const prefix = `${info.id}:`;
          for (const k of deltaLens.keys()) {
            if (k.startsWith(prefix)) deltaLens.delete(k);
          }
          // Mirror the cleanup for lastDeltaContent to avoid stale entries
          // surviving a message-id reuse and suppressing a legitimate delta.
          for (const k of lastDeltaContent.keys()) {
            if (k.startsWith(prefix)) lastDeltaContent.delete(k);
          }
          return;
        }
        const entry = messages.get(info.id);
        if (entry) {
          entry.info = info;
        } else {
          messages.set(info.id, { info, parts: new Map() });
        }
      }),
    );

    offs.push(
      ge.on("message.part.updated", (packet: unknown) => {
        const { part, delta: snapshotDelta } = packet as MessagePartUpdatedPacket;
        // Diagnostic: the protocol may attach a `delta` to part.updated
        // snapshots; we don't currently use it. Log non-empty values so we
        // can decide whether to fold it into the dedup baseline later.
        if (snapshotDelta) {
          console.warn("[dedup] part.updated carries unused `delta` field", {
            messageID: part.messageID,
            partID: part.id,
            len: snapshotDelta.length,
          });
        }
        const entry = messages.get(part.messageID);
        if (!entry) return;
        const existing = entry.parts.get(part.id);
        const key = lensKey(part.messageID, part.id);
        // Re-baseline the delta lens against the incoming snapshot for
        // streaming text/reasoning parts. Without this guard a forking
        // snapshot (one that diverges from the accumulated text mid-stream)
        // leaves the lens pointing past the agreement point, causing every
        // subsequent delta's offset check to fail and the same content to be
        // appended twice — surfacing as the classic "Hello WorldLo World"
        // garbled stream.
        if (
          existing &&
          (existing.type === "text" || existing.type === "reasoning") &&
          (part.type === "text" || part.type === "reasoning") &&
          typeof existing.text === "string" &&
          existing.text.length > 0
        ) {
          const currentLens = deltaLens.get(key) ?? 0;
          if (part.text.length < existing.text.length) {
            // Truncating snapshot — protect the longer accumulated text and
            // leave the lens untouched (it still points into a valid prefix).
            entry.parts.set(part.id, { ...part, text: existing.text });
          } else if (part.text.startsWith(existing.text)) {
            // Extending snapshot — the existing prefix is confirmed, so the
            // currentLens stays valid. Only clamp if it somehow exceeds the
            // new snapshot length (defensive — shouldn't normally happen).
            if (currentLens > part.text.length) deltaLens.set(key, part.text.length);
            entry.parts.set(part.id, { ...part });
          } else {
            // Forking snapshot — the new text diverges from the accumulated
            // text. Collapse the lens to the common prefix so subsequent
            // deltas re-baseline against the canonical snapshot text.
            const lcp = longestCommonPrefixLength(existing.text, part.text);
            const nextLens = Math.min(currentLens, lcp);
            if (nextLens !== currentLens) deltaLens.set(key, nextLens);
            entry.parts.set(part.id, { ...part });
          }
        } else {
          entry.parts.set(part.id, { ...part });
        }
      }),
    );

    offs.push(
      ge.on("message.part.delta", (packet: unknown) => {
        const delta = packet as MessagePartDeltaPacket;
        const entry = messages.get(delta.messageID);
        if (!entry) return;
        const part = entry.parts.get(delta.partID);
        if (!part) {
          // Diagnostic: delta arrived before the part.updated that creates it.
          // This accumulator drops it (unlike useMessages, which auto-creates a
          // part) — log so we can tell how often the ordering races in practice.
          console.warn("[dedup] delta arrived before part.updated (dropped)", {
            messageID: delta.messageID,
            partID: delta.partID,
          });
          return;
        }
        const partRec = part as MessagePart & Record<string, unknown>;
        const key = lensKey(delta.messageID, delta.partID);
        const deltaLen = deltaLens.get(key) ?? 0;
        const deltaKey = `${key}:${delta.field}`;

        // Fast path: drop byte-identical repeated deltas. Some replay paths
        // re-emit the same chunk; without this guard we'd append it twice.
        if (lastDeltaContent.get(deltaKey) === delta.delta) {
          return;
        }
        lastDeltaContent.set(deltaKey, delta.delta);
        const currentText = partRec.text;
        // Snapshot-already-included delta: the substring at [deltaLen,
        // deltaLen+len) matches exactly, so the part.updated snapshot has
        // already folded this text in. Advance the lens but don't append.
        if (
          delta.field === "text" &&
          typeof currentText === "string" &&
          currentText.length >= deltaLen + delta.delta.length &&
          currentText.substring(deltaLen, deltaLen + delta.delta.length) === delta.delta
        ) {
          deltaLens.set(key, deltaLen + delta.delta.length);
          return;
        }

        // Tail-match fallback: when the snapshot already ends with this delta
        // (lens is at/past the snapshot length) the content is present even
        // though the offset check above can't prove it. Drop it to avoid
        // duplicating the trailing chunk. The lens is intentionally left
        // untouched — it already sits at/past the snapshot length, so no
        // advance is needed for subsequent deltas.
        if (
          delta.field === "text" &&
          typeof currentText === "string" &&
          deltaLen >= currentText.length &&
          currentText.length >= delta.delta.length &&
          currentText.endsWith(delta.delta)
        ) {
          return;
        }
        const field = delta.field as keyof typeof part;
        if (field in part && typeof part[field] === "string") {
          (part[field] as string) += delta.delta;
        } else {
          (part as Record<string, unknown>)[field] = delta.delta;
        }
        if (delta.field === "text") {
          deltaLens.set(key, deltaLen + delta.delta.length);
        }
      }),
    );

    offs.push(
      ge.on("message.part.removed", (packet: unknown) => {
        const { messageID, partID } = packet as MessagePartRemovedPacket;
        const entry = messages.get(messageID);
        if (entry) entry.parts.delete(partID);
        // Drop lens + last-seen-delta state for this part so a re-created
        // part reusing the same id isn't falsely deduplicated later.
        const key = lensKey(messageID, partID);
        deltaLens.delete(key);
        const prefix = `${key}:`;
        for (const k of lastDeltaContent.keys()) {
          if (k.startsWith(prefix)) lastDeltaContent.delete(k);
        }
      }),
    );

    offs.push(ge.on("connection.reconnected", () => clear()));

    return () => {
      for (const off of offs) off();
    };
  }

  function getMessage(messageID: string): AccumulatedMessage | undefined {
    return messages.get(messageID);
  }

  function clear(): void {
    messages.clear();
    deltaLens.clear();
    lastDeltaContent.clear();
  }

  return { listen, getMessage, clear };
}
