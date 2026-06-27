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

function lensKey(messageID: string, partID: string): string {
  return `${messageID}:${partID}`;
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
        const { part } = packet as MessagePartUpdatedPacket;
        const entry = messages.get(part.messageID);
        if (!entry) return;
        const existing = entry.parts.get(part.id);
        // Protect streaming text/reasoning from being truncated by an
        // out-of-order `part.updated` snapshot whose text is shorter than
        // what deltas have already accumulated.
        if (
          existing &&
          (existing.type === "text" || existing.type === "reasoning") &&
          (part.type === "text" || part.type === "reasoning") &&
          existing.text &&
          part.text.length < existing.text.length
        ) {
          entry.parts.set(part.id, { ...part, text: existing.text });
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
        if (!part) return;
        const partRec = part as MessagePart & Record<string, unknown>;
        const key = lensKey(delta.messageID, delta.partID);
        const deltaLen = deltaLens.get(key) ?? 0;
        // Deduplicate: skip deltas whose content is already present at the
        // accumulated offset — they were incorporated by a `part.updated`
        // snapshot and would otherwise duplicate.
        const currentText = partRec.text;
        if (
          delta.field === "text" &&
          typeof currentText === "string" &&
          currentText.length >= deltaLen + delta.delta.length &&
          currentText.substring(deltaLen, deltaLen + delta.delta.length) === delta.delta
        ) {
          deltaLens.set(key, deltaLen + delta.delta.length);
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
  }

  return { listen, getMessage, clear };
}
