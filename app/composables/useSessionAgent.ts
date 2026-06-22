// ---------------------------------------------------------------------------
// Session Agent Selection
// ---------------------------------------------------------------------------
// Per-session agent selection stored in memory. Keyed by sessionId.
// A session with no explicit selection returns undefined — callers fall back
// to the backend's default agent (typically "general").
//
// Reset on backend switch so selections from one daemon don't bleed into
// another (session IDs from different backends may collide).
// ---------------------------------------------------------------------------

import { ref } from "vue";

const selections = ref(new Map<string, string>());

function getAgentForSession(sessionId: string): string | undefined {
  if (!sessionId) return undefined;
  return selections.value.get(sessionId);
}

function setAgentForSession(sessionId: string, agentName: string): void {
  if (!sessionId || !agentName) return;
  const next = new Map(selections.value);
  next.set(sessionId, agentName);
  selections.value = next;
}

function clearAgentForSession(sessionId: string): void {
  if (!sessionId || !selections.value.has(sessionId)) return;
  const next = new Map(selections.value);
  next.delete(sessionId);
  selections.value = next;
}

function resetAllSessionAgents(): void {
  selections.value = new Map();
}

export function useSessionAgent() {
  return {
    selections,
    getAgentForSession,
    setAgentForSession,
    clearAgentForSession,
    resetAllSessionAgents,
  };
}
