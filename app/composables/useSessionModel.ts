// ---------------------------------------------------------------------------
// Session Model Selection
// ---------------------------------------------------------------------------
// Per-session model selection stored in memory. Keyed by sessionId.
// A session with no explicit selection returns undefined — callers fall back
// to the backend's default model.
//
// Reset on backend switch so selections from one daemon don't bleed into
// another (session IDs from different backends may collide).
// ---------------------------------------------------------------------------

import { ref } from "vue";

export type SessionModelSelection = {
  providerId: string;
  modelId: string;
};

const selections = ref(new Map<string, SessionModelSelection>());

function getModelForSession(sessionId: string): SessionModelSelection | undefined {
  if (!sessionId) return undefined;
  return selections.value.get(sessionId);
}

function setModelForSession(sessionId: string, providerId: string, modelId: string): void {
  if (!sessionId || !providerId || !modelId) return;
  const next = new Map(selections.value);
  next.set(sessionId, { providerId, modelId });
  selections.value = next;
}

function clearModelForSession(sessionId: string): void {
  if (!sessionId || !selections.value.has(sessionId)) return;
  const next = new Map(selections.value);
  next.delete(sessionId);
  selections.value = next;
}

function resetAllSessionModels(): void {
  selections.value = new Map();
}

export function useSessionModel() {
  return {
    selections,
    getModelForSession,
    setModelForSession,
    clearModelForSession,
    resetAllSessionModels,
  };
}
