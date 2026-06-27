// ---------------------------------------------------------------------------
// Session Status Store (per-session)
// ---------------------------------------------------------------------------
// Tracks busy / idle / retry state for EVERY session by listening to the
// global `session.status` SSE event (unscoped). Previously this was a singleton
// bound to the active session's scope — which meant sub-agent sessions' events
// were filtered out and the active session's state could get stuck. Now each
// session has its own entry, addressable by sessionId.
// ---------------------------------------------------------------------------

import { type Ref, computed, ref } from "vue";
import type { SessionStatusInfo, SessionStatusPacket } from "../types/sse";

const statusBySession = ref(new Map<string, SessionStatusInfo>());
let globalBound = false;

type EventBus = {
  on(event: string, listener: (payload: unknown) => void): () => void;
};

// Bind once to the global event bus. Subsequent calls are no-ops.
function bindGlobal(eventBus: EventBus): void {
  if (globalBound) return;
  globalBound = true;
  eventBus.on("session.status", (payload) => {
    const packet = payload as SessionStatusPacket | undefined;
    if (!packet?.sessionID || !packet.status) return;
    const next = new Map(statusBySession.value);
    next.set(packet.sessionID, packet.status);
    statusBySession.value = next;
  });
}

function statusOf(sessionId: string): SessionStatusInfo {
  return statusBySession.value.get(sessionId) ?? { type: "idle" };
}

function isBusyOf(sessionId: string): boolean {
  return statusOf(sessionId).type === "busy";
}

function isRetryingOf(sessionId: string): boolean {
  return statusOf(sessionId).type === "retry";
}

function remove(sessionId: string): void {
  if (!statusBySession.value.has(sessionId)) return;
  const next = new Map(statusBySession.value);
  next.delete(sessionId);
  statusBySession.value = next;
}

/**
 * Force a session to idle. Used as a fallback when the backend signals task
 * completion (message finish/error) but never sends `session.status=idle`
 * (common on timeout / abort / crash paths). No-op if the session is already
 * idle or unknown — never creates a stale entry.
 */
function markIdle(sessionId: string): void {
  if (!sessionId) return;
  const current = statusBySession.value.get(sessionId);
  if (!current || current.type === "idle") return;
  const next = new Map(statusBySession.value);
  next.set(sessionId, { type: "idle" });
  statusBySession.value = next;
}

function markBusy(sessionId: string): void {
  if (!sessionId) return;
  const current = statusBySession.value.get(sessionId);
  if (current?.type === "busy") return;
  const next = new Map(statusBySession.value);
  next.set(sessionId, { type: "busy" });
  statusBySession.value = next;
}

function reset(): void {
  statusBySession.value = new Map();
}

export function useSessionStatus(selectedSessionId?: Ref<string>) {
  const activeId = () => selectedSessionId?.value ?? "";
  return {
    statusBySession,
    statusOf,
    isBusyOf,
    isRetryingOf,
    remove,
    markIdle,
    markBusy,
    reset,
    bindGlobal,
    // Active-session views (backwards-compatible with InputPanel / StatusBar).
    status: computed(() => statusOf(activeId())),
    isBusy: computed(() => isBusyOf(activeId())),
    isRetrying: computed(() => isRetryingOf(activeId())),
  };
}
