// ---------------------------------------------------------------------------
// Central Message Store
// ---------------------------------------------------------------------------
// Module-level singleton message store using shallowRef + batched microtask
// updates for optimal streaming performance.
// - Session cache (max 5 entries) for instant tab switching
// - History pagination (150 entries per chunk)
// - Delta accumulation integration for streaming text
// Ported from opencode-visualizer-cn/app/composables/useMessages.ts
// ---------------------------------------------------------------------------

import { computed, readonly, shallowRef, triggerRef } from "vue";
import type { ShallowRef } from "vue";
import type {
  MessageAttachment,
  MessageDiffEntry,
  MessageStatus,
  MessageUsage,
} from "../types/message";
import type {
  FileDiff,
  MessageInfo,
  MessagePart,
  MessagePartDeltaPacket,
  MessagePartRemovedPacket,
  MessagePartUpdatedPacket,
  MessageUpdatedPacket,
  SessionDiffPacket,
  TextPart,
  ToolPart,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
  UserMessageInfo,
} from "../types/sse";
import type { SessionScope } from "./useGlobalEvents";
import { useDeltaAccumulator } from "./useDeltaAccumulator";

// ── Internal types ────────────────────────────────────────────────────────

type MessageEntry = {
  info?: MessageInfo;
  parts: Set<ShallowRef<MessagePart>>;
};

type MessageError = { name: string; message: string } | null;

// ── Constants ─────────────────────────────────────────────────────────────

const HISTORY_CHUNK_SIZE = 150;
const MAX_SESSION_CACHE_ENTRIES = 5;

// ── Batched update system ─────────────────────────────────────────────────

const pendingMessageTriggers = new Set<ShallowRef<MessageEntry>>();
const pendingCollectionTrigger = { value: false };
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    for (const ref of pendingMessageTriggers) {
      triggerRef(ref);
    }
    pendingMessageTriggers.clear();
    if (pendingCollectionTrigger.value) {
      pendingCollectionTrigger.value = false;
      triggerRef(messages);
    }
  });
}

function triggerMessageRef(ref: ShallowRef<MessageEntry>) {
  pendingMessageTriggers.add(ref);
  scheduleFlush();
}

function triggerCollection() {
  pendingCollectionTrigger.value = true;
  scheduleFlush();
}

// ── Helpers ───────────────────────────────────────────────────────────────

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const OMO_INIT_COMMENT_RE = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/g;
// Inline reasoning block emitted by some models directly in the text stream.
// The non-greedy `[\s\S]*?` matches across newlines; the alternation with `$`
// tolerates an unclosed `<think>` tag mid-stream (we still strip it).
const THINK_BLOCK_RE = /<think>[\s\S]*?(<\/think>|$)/g;
// Chat-template role markers that some backends leak as standalone lines
// (e.g. a literal `assistant` or `user` line wrapping the actual content).
const ROLE_MARKER_LINE_RE = /(^|\n)[ \t]*(assistant|user)[ \t]*(\n|$)/g;
// Three-or-more consecutive newlines left behind after stripping the above
// noise blocks — collapse to a single blank line so markdown doesn't render
// a stack of empty paragraphs.
const EXCESS_BLANK_LINES_RE = /\n{3,}/g;

// Longest common prefix length of two strings. Used to re-baseline the delta
// lens when a `part.updated` snapshot forks from the accumulated text.
function longestCommonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Remove agent-injected `<system-reminder>` blocks, OMO initiator markers,
 *  inline `<think>` reasoning blocks, leaked chat-template role marker lines,
 *  and the excess blank lines their removal leaves behind. */
export function stripSystemReminder(text: string): string {
  if (!text) return text;
  return text
    .replace(SYSTEM_REMINDER_RE, "")
    .replace(OMO_INIT_COMMENT_RE, "")
    .replace(THINK_BLOCK_RE, "")
    .replace(ROLE_MARKER_LINE_RE, "\n")
    .replace(EXCESS_BLANK_LINES_RE, "\n\n")
    .trim();
}

/** True when a text chunk still carries user-visible content after stripping. */
export function isSignificantText(text: string): boolean {
  return stripSystemReminder(text).length > 0;
}

function createMessageEntry(): MessageEntry {
  return { parts: new Set<ShallowRef<MessagePart>>() };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isMessageInfo(value: unknown): value is MessageInfo {
  const rec = toRecord(value);
  if (!rec) return false;
  if (!asString(rec.id)) return false;
  if (!asString(rec.sessionID)) return false;
  return rec.role === "user" || rec.role === "assistant";
}

function isMessagePart(value: unknown): value is MessagePart {
  const rec = toRecord(value);
  if (!rec) return false;
  if (!asString(rec.id)) return false;
  if (!asString(rec.sessionID)) return false;
  if (!asString(rec.messageID)) return false;
  return typeof rec.type === "string";
}

// ── Normalization ─────────────────────────────────────────────────────────

function normalizeTokens(value: unknown): MessageUsage["tokens"] | undefined {
  const rec = toRecord(value);
  if (!rec) return undefined;
  const input = asNumber(rec.input);
  const output = asNumber(rec.output);
  const reasoning = asNumber(rec.reasoning);
  if (input === undefined || output === undefined || reasoning === undefined) return undefined;
  const total = asNumber(rec.total);
  const cacheRec = toRecord(rec.cache);
  const cacheRead = asNumber(cacheRec?.read);
  const cacheWrite = asNumber(cacheRec?.write);
  return {
    input,
    output,
    reasoning,
    total,
    cache:
      cacheRead === undefined || cacheWrite === undefined
        ? undefined
        : { read: cacheRead, write: cacheWrite },
  };
}

function getProviderId(info?: MessageInfo): string | undefined {
  if (!info) return undefined;
  if (info.role === "assistant") return asString(info.providerID);
  const model = toRecord((info as Record<string, unknown>).model);
  return asString(model?.providerID);
}

function getModelId(info?: MessageInfo): string | undefined {
  if (!info) return undefined;
  if (info.role === "assistant") return asString(info.modelID);
  const model = toRecord((info as Record<string, unknown>).model);
  return asString(model?.modelID);
}

function normalizeUsage(info?: MessageInfo): MessageUsage | undefined {
  if (!info || info.role !== "assistant") return undefined;
  const tokens = normalizeTokens(info.tokens);
  if (!tokens) return undefined;
  return {
    tokens,
    cost: asNumber(info.cost),
    providerId: getProviderId(info),
    modelId: getModelId(info),
  };
}

function resolveStatus(info?: MessageInfo): MessageStatus {
  if (!info) return "streaming";
  if (info.role === "user") return "complete";
  if (info.error || info.finish === "error") return "error";
  if (info.time?.completed !== undefined || info.finish) return "complete";
  return "streaming";
}

function resolveError(info?: MessageInfo): MessageError {
  const status = resolveStatus(info);
  if (!info || info.role !== "assistant") return null;
  if (!info.error) return status === "error" ? { name: "Error", message: "" } : null;
  const message = asString(toRecord(info.error.data)?.message) ?? "";
  return { name: info.error.name, message };
}

function byTimeThenId(a: MessageInfo, b: MessageInfo): number {
  const aTime = asNumber(a.time?.created) ?? 0;
  const bTime = asNumber(b.time?.created) ?? 0;
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}

// ── Module-level singleton state ──────────────────────────────────────────

const acc = useDeltaAccumulator();
const messages = shallowRef(new Map<string, ShallowRef<MessageEntry>>());
const parts = new Map<string, ShallowRef<MessagePart>>();
const sessionDiffs = shallowRef(new Map<string, FileDiff[]>());

// Tracks how many chars each part has accumulated via `message.part.delta`
// events. Used by applyPartDelta to detect duplicate deltas — a `part.updated`
// snapshot from the server can pre-include text that subsequent late deltas
// would otherwise append again, producing duplicated streaming output.
// Keyed by the same `${messageID}:${partID}` used by `parts`.
const deltaLens = new Map<string, number>();

// Remembers the last delta payload seen per `${messageID}:${partID}:${field}`.
// Drops a delta that is byte-identical to the immediately preceding one for
// the same field — replay paths occasionally re-emit the same chunk, and the
// lens check can't catch it when no snapshot has landed in between. Assumes
// the stream never legitimately sends the same payload twice in a row (true
// for LLM token streams). Keyed by `${key}:${field}`.
const lastDeltaContent = new Map<string, string>();

// ── Computed indices ──────────────────────────────────────────────────────

const roots = computed(() => {
  const result: MessageInfo[] = [];
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (!info) continue;
    if (info.role === "user") {
      result.push(info);
      continue;
    }
    const parent = messages.value.get(info.parentID)?.value.info;
    if (!parent) result.push(info);
  }
  return result.sort(byTimeThenId);
});

const streaming = computed(() => {
  const result: MessageInfo[] = [];
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (!info) continue;
    if (resolveStatus(info) !== "streaming") continue;
    result.push(info);
  }
  return result.sort(byTimeThenId);
});

const childrenByParent = computed(() => {
  const index = new Map<string, MessageInfo[]>();
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (!info || info.role !== "assistant") continue;
    let list = index.get(info.parentID);
    if (!list) {
      list = [];
      index.set(info.parentID, list);
    }
    list.push(info);
  }
  for (const list of index.values()) {
    list.sort(byTimeThenId);
  }
  return index;
});

// ── Core operations ───────────────────────────────────────────────────────

function ensureMessage(id: string, notifyCollection = true): ShallowRef<MessageEntry> {
  let ref = messages.value.get(id);
  if (ref) return ref;
  ref = shallowRef(createMessageEntry());
  messages.value.set(id, ref);
  if (notifyCollection) triggerCollection();
  return ref;
}

function partLookupKey(messageId: string, partId: string): string {
  return `${messageId}:${partId}`;
}

function hasPart(messageId: string, partId: string): boolean {
  if (!messageId || !partId) return false;
  return parts.has(partLookupKey(messageId, partId));
}

function updateMessage(info: MessageInfo, notifyCollection = true) {
  // Auto-clean optimistic pending messages when a real user message arrives
  if (info.role === "user" && !info.id.startsWith("pending:")) {
    for (const id of [...messages.value.keys()]) {
      if (id.startsWith("pending:")) removeMessage(id);
    }
  }
  const messageRef = ensureMessage(info.id, notifyCollection);
  messageRef.value.info = info;
  triggerMessageRef(messageRef);
}

function updatePart(part: MessagePart, notifyCollection = true) {
  const key = partLookupKey(part.messageID, part.id);
  const existing = parts.get(key);
  if (existing) {
    const current = existing.value;
    // Re-baseline the delta lens against the incoming snapshot for streaming
    // text/reasoning parts. A forking snapshot (one that diverges from the
    // accumulated text mid-stream) would otherwise leave the lens pointing
    // past the agreement point, causing every subsequent delta's offset check
    // to fail and the same content to be appended twice — surfacing as the
    // classic garbled stream of overlapping text.
    if (
      (current.type === "text" || current.type === "reasoning") &&
      (part.type === "text" || part.type === "reasoning") &&
      typeof current.text === "string" &&
      current.text.length > 0
    ) {
      const currentLens = deltaLens.get(key) ?? 0;
      if (part.text.length < current.text.length) {
        // Truncating snapshot — protect the longer accumulated text; the lens
        // still points into a valid prefix so it stays as-is.
        existing.value = { ...part, text: current.text };
      } else if (part.text.startsWith(current.text)) {
        // Extending snapshot — existing prefix is confirmed, lens stays valid.
        if (currentLens > part.text.length) deltaLens.set(key, part.text.length);
        existing.value = part;
      } else {
        // Forking snapshot — collapse the lens to the common prefix so later
        // deltas re-baseline against the canonical snapshot text.
        const lcp = longestCommonPrefixLength(current.text, part.text);
        const nextLens = Math.min(currentLens, lcp);
        if (nextLens !== currentLens) deltaLens.set(key, nextLens);
        existing.value = part;
      }
    } else {
      existing.value = part;
    }
    triggerRef(existing);
    return;
  }
  const partRef = shallowRef(part);
  parts.set(key, partRef);
  const messageRef = ensureMessage(part.messageID, notifyCollection);
  messageRef.value.parts.add(partRef);
  triggerMessageRef(messageRef);
}

function applyPartDelta(delta: MessagePartDeltaPacket) {
  const key = partLookupKey(delta.messageID, delta.partID);
  let partRef = parts.get(key);

  if (!partRef) {
    if (delta.field !== "text") return;
    const part: TextPart = {
      id: delta.partID,
      sessionID: delta.sessionID,
      messageID: delta.messageID,
      type: "text",
      text: "",
    };
    partRef = shallowRef(part);
    parts.set(key, partRef);
    deltaLens.set(key, 0);
    const messageRef = ensureMessage(delta.messageID);
    messageRef.value.parts.add(partRef);
    triggerMessageRef(messageRef);
  }

  const current = partRef.value as MessagePart & Record<string, unknown>;
  const deltaLen = deltaLens.get(key) ?? 0;
  const deltaKey = `${key}:${delta.field}`;

  // Fast path: drop byte-identical repeated deltas. Some replay paths
  // re-emit the same chunk; without this guard we'd append it twice.
  if (lastDeltaContent.get(deltaKey) === delta.delta) {
    return;
  }
  lastDeltaContent.set(deltaKey, delta.delta);
  // Snapshot-already-included delta: the substring at [deltaLen, deltaLen+len)
  // matches exactly, so the part.updated snapshot has already folded this text
  // in. Advance the lens but don't append.
  if (
    delta.field === "text" &&
    typeof current.text === "string" &&
    current.text.length >= deltaLen + delta.delta.length &&
    current.text.substring(deltaLen, deltaLen + delta.delta.length) === delta.delta
  ) {
    deltaLens.set(key, deltaLen + delta.delta.length);
    return;
  }

  // Tail-match fallback: when the snapshot already ends with this delta (lens
  // is at/past the snapshot length) the content is present even though the
  // offset check above can't prove it. Drop it to avoid duplicating the
  // trailing chunk. The lens is intentionally left untouched — it already
  // sits at/past the snapshot length, so no advance is needed for subsequent
  // deltas.
  if (
    delta.field === "text" &&
    typeof current.text === "string" &&
    deltaLen >= current.text.length &&
    current.text.length >= delta.delta.length &&
    current.text.endsWith(delta.delta)
  ) {
    return;
  }

  const value = current[delta.field];
  current[delta.field] = typeof value === "string" ? value + delta.delta : delta.delta;
  if (delta.field === "text") {
    deltaLens.set(key, deltaLen + delta.delta.length);
  }
  triggerRef(partRef);

  const messageRef = messages.value.get(delta.messageID);
  if (messageRef) triggerMessageRef(messageRef);
}

// ── Optimistic (pending) messages ─────────────────────────────────────────

function addPendingUserMessage(sessionId: string, text: string, agentName: string): string {
  const now = Date.now();
  const tempId = `pending:${now}`;
  const partId = `pending:part:${now}`;
  const info: UserMessageInfo = {
    id: tempId,
    sessionID: sessionId,
    role: "user",
    time: { created: now },
    agent: agentName,
    model: { providerID: "", modelID: "" },
  };
  const part: TextPart = {
    id: partId,
    sessionID: sessionId,
    messageID: tempId,
    type: "text",
    text,
  };
  updateMessage(info);
  updatePart(part);
  return tempId;
}

// ── SSE binding ───────────────────────────────────────────────────────────

const unsubs: Array<() => void> = [];

function bindScope(scope: SessionScope) {
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;

  unsubs.push(
    scope.on("message.part.updated", (packet: unknown) => {
      const p = packet as MessagePartUpdatedPacket;
      // Diagnostic: mirror the useDeltaAccumulator probe — log when the
      // protocol attaches a `delta` to a snapshot so we can evaluate its use.
      if (p.delta) {
        console.warn("[dedup] part.updated carries unused `delta` field", {
          messageID: p.part?.messageID,
          partID: p.part?.id,
          len: p.delta.length,
        });
      }
      updatePart(p.part);
    }),
  );

  unsubs.push(
    scope.on("message.part.delta", (packet: unknown) => {
      const delta = packet as MessagePartDeltaPacket;
      applyPartDelta(delta);
    }),
  );

  unsubs.push(
    scope.on("message.part.removed", (packet: unknown) => {
      const { messageID, partID } = packet as MessagePartRemovedPacket;
      const key = partLookupKey(messageID, partID);
      const partRef = parts.get(key);
      if (!partRef) return;
      parts.delete(key);
      deltaLens.delete(key);
      // lastDeltaContent keys carry an extra `:${field}` suffix, so there's
      // no single key to delete — drop every entry prefixed by this part key
      // so a re-created part reusing the id isn't falsely deduplicated.
      const prefix = `${key}:`;
      for (const lk of lastDeltaContent.keys()) {
        if (lk.startsWith(prefix)) lastDeltaContent.delete(lk);
      }
      const messageRef = messages.value.get(messageID);
      if (messageRef) {
        messageRef.value.parts.delete(partRef);
        triggerMessageRef(messageRef);
      }
      triggerCollection();
    }),
  );

  unsubs.push(
    scope.on("message.updated", (packet: unknown) => {
      updateMessage((packet as MessageUpdatedPacket).info);
    }),
  );

  unsubs.push(
    scope.on("session.diff", (packet: unknown) => {
      const { sessionID, diff } = packet as SessionDiffPacket;
      if (!sessionID) return;
      sessionDiffs.value.set(sessionID, Array.isArray(diff) ? diff : []);
      triggerRef(sessionDiffs);
    }),
  );

  // On reconnect the server replays part snapshots, which can race with
  // in-flight deltas and produce duplicated text. Reset the delta lens so
  // the dedup check re-baselines against the fresh snapshot stream.
  unsubs.push(
    scope.on("connection.reconnected", () => {
      deltaLens.clear();
      lastDeltaContent.clear();
    }),
  );
}

// ── Public query API ──────────────────────────────────────────────────────

function get(id: string): MessageInfo | undefined {
  return messages.value.get(id)?.value.info;
}

function list(): MessageInfo[] {
  const result: MessageInfo[] = [];
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (info) {
      result.push(info);
      continue;
    }
    // Tool / reasoning parts can arrive via `message.part.updated` BEFORE the
    // corresponding `message.updated` envelope. If we skip entries without
    // info here, the chat view filters them out and the user sees nothing
    // while the assistant is making tool calls. Synthesize a minimal info so
    // the message is listable until the real info arrives.
    const parts = messageRef.value.parts;
    if (parts.size === 0) continue;
    let inferredId: string | undefined;
    let inferredSessionId: string | undefined;
    for (const partRef of parts) {
      const p = partRef.value as MessagePart;
      inferredId ??= p.messageID;
      inferredSessionId ??= p.sessionID;
      if (inferredId) break;
    }
    if (!inferredId) continue;
    result.push({
      id: inferredId,
      sessionID: inferredSessionId ?? "",
      role: "assistant",
      time: { created: 0 },
    } as MessageInfo);
  }
  return result.sort(byTimeThenId);
}

function getParts(id: string): MessagePart[] {
  const messageRef = messages.value.get(id);
  if (!messageRef) return [];
  const result: MessagePart[] = [];
  for (const partRef of messageRef.value.parts) {
    result.push(partRef.value);
  }
  return result;
}

function hasActiveToolParts(sessionId: string): boolean {
  if (!sessionId) return false;
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (info?.sessionID && info.sessionID !== sessionId) continue;
    for (const partRef of messageRef.value.parts) {
      const part = partRef.value;
      if (part.sessionID !== sessionId || part.type !== "tool") continue;
      if (part.state.status === "pending" || part.state.status === "running") return true;
    }
  }
  return false;
}

function finalizeActiveToolParts(
  sessionId: string,
  buildState: (state: ToolStatePending | ToolStateRunning) => ToolStateCompleted | ToolStateError,
): void {
  if (!sessionId) return;
  for (const messageRef of messages.value.values()) {
    let touchedMessage = false;
    for (const partRef of messageRef.value.parts) {
      const part = partRef.value;
      if (part.sessionID !== sessionId || part.type !== "tool") continue;
      const state = part.state;
      if (state.status !== "pending" && state.status !== "running") continue;
      const toolPart = part as ToolPart;
      partRef.value = { ...toolPart, state: buildState(state) };
      triggerRef(partRef);
      touchedMessage = true;
    }
    if (touchedMessage) triggerMessageRef(messageRef);
  }
}

function markActiveToolPartsError(sessionId: string, message: string): void {
  finalizeActiveToolParts(sessionId, (state) => {
    const isRunning = state.status === "running";
    const start = isRunning ? state.time.start : Math.floor(Date.now() / 1000);
    return {
      status: "error",
      input: state.input,
      error: message,
      metadata: isRunning ? state.metadata : undefined,
      time: { start, end: Date.now() / 1000 },
    };
  });
}

function markActiveToolPartsCompleted(sessionId: string): void {
  const nowSec = Date.now() / 1000;
  finalizeActiveToolParts(sessionId, (state) => {
    const isRunning = state.status === "running";
    return {
      status: "completed",
      input: state.input,
      output: "",
      title: isRunning ? (state.title ?? "") : "",
      metadata: (isRunning ? state.metadata : {}) ?? {},
      time: { start: isRunning ? state.time.start : Math.floor(nowSec), end: nowSec },
    };
  });
}

/**
 * Whether any assistant message for the given session is still streaming.
 * Used by connection-loss / abort fallbacks to decide whether there's
 * anything to clean up — without this they would early-return when there
 * are no active tool parts, leaving an empty "正在思考" stuck forever.
 */
function hasStreamingAssistantMessages(sessionId: string): boolean {
  if (!sessionId) return false;
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (!info || info.role !== "assistant") continue;
    if (info.sessionID !== sessionId) continue;
    if (resolveStatus(info) === "streaming") return true;
  }
  return false;
}

/**
 * Force every still-streaming assistant message for `sessionId` into the
 * "error" state by injecting a synthetic error envelope matching the SSE
 * MessageError shape ({ name, data: { message } }). Used when the backend
 * silently drops a connection or hangs before emitting any completion
 * signal — without this fabrication the UI would show "正在思考" forever.
 */
function failStreamingAssistantMessages(sessionId: string, errorMessage: string): void {
  if (!sessionId) return;
  let touched = false;
  for (const messageRef of messages.value.values()) {
    const info = messageRef.value.info;
    if (!info || info.role !== "assistant") continue;
    if (info.sessionID !== sessionId) continue;
    if (resolveStatus(info) !== "streaming") continue;
    messageRef.value.info = {
      ...info,
      error: { name: "StreamingTimeout", data: { message: errorMessage } },
    };
    triggerMessageRef(messageRef);
    touched = true;
  }
  if (touched) triggerCollection();
}

function getPartsByType<T extends MessagePart["type"]>(
  id: string,
  type: T,
): Array<Extract<MessagePart, { type: T }>> {
  const result: Array<Extract<MessagePart, { type: T }>> = [];
  const messageRef = messages.value.get(id);
  if (!messageRef) return result;
  for (const partRef of messageRef.value.parts) {
    const part = partRef.value;
    if (part.type !== type) continue;
    result.push(part as Extract<MessagePart, { type: T }>);
  }
  return result;
}

function hasTextContent(id: string): boolean {
  const messageRef = messages.value.get(id);
  if (!messageRef) return false;
  for (const partRef of messageRef.value.parts) {
    const part = partRef.value;
    if (part.type === "text" && part.text) return true;
  }
  return false;
}

function getTextContent(id: string): string {
  const chunks: string[] = [];
  const textParts = getPartsByType(id, "text");
  for (const part of textParts) {
    if (!part.text) continue;
    chunks.push(part.text);
  }
  return chunks.join("");
}

function getImageAttachments(id: string): MessageAttachment[] | undefined {
  const files = getPartsByType(id, "file");
  if (files.length === 0) return undefined;
  const result: MessageAttachment[] = [];
  let index = 0;
  for (const part of files) {
    if (!part.mime.startsWith("image/")) continue;
    result.push({
      id: part.id,
      url: part.url,
      mime: part.mime,
      filename: part.filename ?? `attachment-${index + 1}`,
    });
    index += 1;
  }
  return result.length > 0 ? result : undefined;
}

function getUsage(id: string): MessageUsage | undefined {
  return normalizeUsage(get(id));
}

function getStatus(id: string): MessageStatus {
  return resolveStatus(get(id));
}

function getError(id: string): MessageError {
  return resolveError(get(id));
}

/**
 * Whether a message should render in the chat transcript.
 * Synthetic / system-reminder-injected user messages are hidden so the
 * conversation isn't polluted by agent-framework bookkeeping.
 */
function isDisplayable(id: string): boolean {
  const info = get(id);
  if (!info) return false;
  if (info.role !== "user") return true;
  // Pending optimistic messages are always displayable.
  if (id.startsWith("pending:")) return true;
  for (const part of getParts(id)) {
    if (part.type !== "text") continue;
    if (part.synthetic) continue;
    if (isSignificantText(part.text)) return true;
  }
  return false;
}

function getDiffs(id: string): MessageDiffEntry[] | undefined {
  const info = get(id);
  if (!info || info.role !== "user" || !info.summary?.diffs) return undefined;
  const result: MessageDiffEntry[] = [];
  for (const diff of info.summary.diffs) {
    if (!diff.file) continue;
    result.push({
      file: diff.file,
      diff: diff.patch ?? "",
      before: diff.before,
      after: diff.after,
      additions: diff.additions,
      deletions: diff.deletions,
    });
  }
  return result.length > 0 ? result : undefined;
}

function getSessionDiffs(sessionId: string): MessageDiffEntry[] | undefined {
  const diffs = sessionDiffs.value.get(sessionId);
  if (!diffs || diffs.length === 0) return undefined;
  const result: MessageDiffEntry[] = [];
  for (const diff of diffs) {
    if (!diff.file) continue;
    result.push({
      file: diff.file,
      diff: diff.patch ?? "",
      before: diff.before,
      after: diff.after,
      additions: diff.additions,
      deletions: diff.deletions,
    });
  }
  return result.length > 0 ? result : undefined;
}

function setSessionDiffs(sessionId: string, diffs: FileDiff[]) {
  if (!sessionId) return;
  sessionDiffs.value.set(sessionId, diffs);
  triggerRef(sessionDiffs);
}

function getLatestAssistantMessageId(sessionId: string): string | undefined {
  const assistants = list()
    .filter((message) => message.sessionID === sessionId && message.role === "assistant")
    .sort(byTimeThenId);
  return assistants[assistants.length - 1]?.id;
}

function getModelPath(id: string): string | undefined {
  const info = get(id);
  if (!info) return undefined;
  const providerId = getProviderId(info);
  const modelId = getModelId(info);
  if (providerId && modelId) return `${providerId}/${modelId}`;
  return modelId || providerId;
}

function getTime(id: string): number | undefined {
  const info = get(id);
  if (!info) return undefined;
  return asNumber(info.time?.created);
}

function getCompletedTime(id: string): number | undefined {
  const info = get(id);
  if (!info) return undefined;
  if (info.role === "assistant")
    return asNumber(info.time?.completed) ?? asNumber(info.time?.created);
  return asNumber(info.time?.created);
}

function getChildren(parentId: string): MessageInfo[] {
  return childrenByParent.value.get(parentId) ?? [];
}

function getThread(rootId: string): MessageInfo[] {
  const root = get(rootId);
  if (!root) return [];
  const result: MessageInfo[] = [];
  const queue: string[] = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const info = get(current);
    if (!info) continue;
    result.push(info);
    const children = getChildren(current);
    for (const child of children) queue.push(child.id);
  }
  return result.sort(byTimeThenId);
}

function getFinalAnswer(rootId: string): MessageInfo | undefined {
  const thread = getThread(rootId);
  const assistants = thread
    .filter((message) => message.role === "assistant" && hasTextContent(message.id))
    .sort(byTimeThenId);
  return assistants[assistants.length - 1];
}

// ── History loading ───────────────────────────────────────────────────────

function loadHistory(entries: unknown[]) {
  let collectionChanged = false;
  for (const entry of entries) {
    const rec = toRecord(entry);
    if (!rec) continue;
    const info = rec.info;
    const partsList = rec.parts;
    if (!isMessageInfo(info)) continue;

    const accumulated = acc.getMessage(info.id);
    const hasMessage = messages.value.has(info.id);
    const messageRef = ensureMessage(info.id, false);
    if (!hasMessage) collectionChanged = true;

    const mergedInfo = accumulated?.info ?? info;
    if (
      !messageRef.value.info ||
      JSON.stringify(messageRef.value.info) !== JSON.stringify(mergedInfo)
    ) {
      messageRef.value.info = mergedInfo;
      triggerMessageRef(messageRef);
    }

    if (!Array.isArray(partsList)) continue;
    let addedPart = false;
    for (const item of partsList) {
      if (!isMessagePart(item)) continue;
      const merged = accumulated?.parts.get(item.id) ?? item;
      const key = partLookupKey(merged.messageID, merged.id);
      const existingPart = parts.get(key);
      if (existingPart) {
        if (JSON.stringify(existingPart.value) !== JSON.stringify(merged)) {
          existingPart.value = merged;
          triggerRef(existingPart);
        }
        continue;
      }
      const partRef = shallowRef(merged);
      parts.set(key, partRef);
      messageRef.value.parts.add(partRef);
      addedPart = true;
    }

    if (accumulated) {
      for (const [, accPart] of accumulated.parts) {
        const key = partLookupKey(accPart.messageID, accPart.id);
        const existingPart = parts.get(key);
        if (existingPart) {
          if (JSON.stringify(existingPart.value) !== JSON.stringify(accPart)) {
            existingPart.value = accPart;
            triggerRef(existingPart);
          }
          continue;
        }
        const partRef = shallowRef(accPart);
        parts.set(key, partRef);
        messageRef.value.parts.add(partRef);
        addedPart = true;
      }
    }
    if (addedPart) triggerMessageRef(messageRef);
  }
  if (collectionChanged) triggerCollection();
}

async function loadHistoryIncrementally(
  entries: unknown[],
  options?: {
    chunkSize?: number;
    shouldContinue?: () => boolean;
  },
) {
  const chunkSize = Math.max(1, options?.chunkSize ?? HISTORY_CHUNK_SIZE);
  for (let offset = 0; offset < entries.length; offset += chunkSize) {
    if (options?.shouldContinue && !options.shouldContinue()) return;
    loadHistory(entries.slice(offset, offset + chunkSize));
    if (offset + chunkSize < entries.length) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
  }
}

// ── Session cache ─────────────────────────────────────────────────────────

type MessageCacheEntry = {
  messages: Map<string, { info?: MessageInfo; parts: MessagePart[] }>;
  parts: Map<string, MessagePart>;
};

const sessionCache = new Map<string, MessageCacheEntry>();

function saveSessionState(sessionId: string) {
  if (!sessionId || messages.value.size === 0) return;
  // Don't cache while streaming
  for (const messageRef of messages.value.values()) {
    if (resolveStatus(messageRef.value.info) === "streaming") return;
  }
  // Evict oldest if at capacity
  if (sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey !== undefined) sessionCache.delete(oldestKey);
  }

  const cachedMessages = new Map<string, { info?: MessageInfo; parts: MessagePart[] }>();
  const cachedParts = new Map<string, MessagePart>();

  for (const [id, messageRef] of messages.value) {
    const entry = messageRef.value;
    const partsList: MessagePart[] = [];
    for (const partRef of entry.parts) {
      const part = partRef.value;
      partsList.push(part);
      cachedParts.set(partLookupKey(part.messageID, part.id), part);
    }
    cachedMessages.set(id, { info: entry.info, parts: partsList });
  }

  sessionCache.set(sessionId, {
    messages: cachedMessages,
    parts: cachedParts,
  });
}

function tryLoadFromCache(sessionId: string): boolean {
  const cached = sessionCache.get(sessionId);
  if (!cached) return false;

  messages.value.clear();
  parts.clear();
  deltaLens.clear();
  lastDeltaContent.clear();

  for (const [id, cachedEntry] of cached.messages) {
    const entry = createMessageEntry();
    entry.info = cachedEntry.info;
    for (const part of cachedEntry.parts) {
      const partRef = shallowRef(part);
      const key = partLookupKey(part.messageID, part.id);
      parts.set(key, partRef);
      entry.parts.add(partRef);
    }
    messages.value.set(id, shallowRef(entry));
  }

  triggerCollection();
  return true;
}

// ── Reset / cleanup ───────────────────────────────────────────────────────

function reset() {
  messages.value.clear();
  parts.clear();
  deltaLens.clear();
  lastDeltaContent.clear();
  sessionDiffs.value.clear();
  triggerRef(sessionDiffs);
  triggerCollection();
}

function removeMessage(id: string) {
  const messageRef = messages.value.get(id);
  if (!messageRef) return;
  for (const partRef of messageRef.value.parts) {
    const part = partRef.value;
    const key = partLookupKey(part.messageID, part.id);
    parts.delete(key);
    deltaLens.delete(key);
  }
  // lastDeltaContent keys carry an extra `:${field}` suffix, so there's no
  // single key to delete — drop every entry prefixed by this message id.
  for (const lk of lastDeltaContent.keys()) {
    if (lk.startsWith(`${id}:`)) lastDeltaContent.delete(lk);
  }
  messages.value.delete(id);
  triggerCollection();
}

function dispose() {
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;
  sessionDiffs.value.clear();
  triggerRef(sessionDiffs);
}

// ── Export ────────────────────────────────────────────────────────────────

export function useMessages() {
  return {
    messages: readonly(messages),
    roots,
    streaming,
    get,
    list,
    getParts,
    hasActiveToolParts,
    hasStreamingAssistantMessages,
    failStreamingAssistantMessages,
    hasPart,
    markActiveToolPartsError,
    markActiveToolPartsCompleted,
    getPartsByType,
    hasTextContent,
    getTextContent,
    getImageAttachments,
    getUsage,
    getStatus,
    getError,
    isDisplayable,
    getDiffs,
    getSessionDiffs,
    setSessionDiffs,
    getLatestAssistantMessageId,
    getModelPath,
    getProviderId,
    getModelId,
    getTime,
    getCompletedTime,
    getChildren,
    getThread,
    getFinalAnswer,
    updateMessage,
    updatePart,
    addPendingUserMessage,
    loadHistory,
    loadHistoryIncrementally,
    removeMessage,
    reset,
    saveSessionState,
    tryLoadFromCache,
    dispose,
    bindScope,
  };
}
