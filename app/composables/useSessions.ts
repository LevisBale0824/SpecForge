// ---------------------------------------------------------------------------
// Sessions Store
// ---------------------------------------------------------------------------
// Reactive list of known sessions for the sidebar. Fed by SSE session.* events
// and by local createSession results. Keeps the sidebar in sync so users can
// start a new conversation and still switch back to previous ones.
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import type { SessionInfo } from "../types/sse";
import { useStageSessions } from "./useStageSessions";

const sessions = ref(new Map<string, SessionInfo>());

// Stage-bound workflow sessions are绝对过滤 from the main sidebar list —
// independent of selection state; they are only reachable via the track.
const { stageSessionIds } = useStageSessions();

function upsert(info: SessionInfo): void {
  if (!info?.id) return;
  // Replace the map instance so Vue notices the change (Map mutation is shallow).
  const next = new Map(sessions.value);
  next.set(info.id, info);
  sessions.value = next;
}

function remove(id: string): void {
  if (!sessions.value.has(id)) return;
  const next = new Map(sessions.value);
  next.delete(id);
  sessions.value = next;
}

function reset(): void {
  sessions.value = new Map();
}

export function useSessions() {
  return {
    sessions,
    // Sorted: pinned first, then by last-updated descending.
    sortedSessions: computed(() => {
      return [...sessions.value.values()]
        .filter((s) => !stageSessionIds.value.has(s.id))
        .sort((a, b) => {
          if (a.time.pinned && !b.time.pinned) return -1;
          if (!a.time.pinned && b.time.pinned) return 1;
          return (b.time.updated ?? 0) - (a.time.updated ?? 0);
        });
    }),
    upsert,
    remove,
    reset,
  };
}
