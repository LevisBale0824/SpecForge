// ---------------------------------------------------------------------------
// Stage Sessions Registry (global)
// ---------------------------------------------------------------------------
// Tracks which backend session is bound to each (workflowKey × stage) pair.
// Lifted out of WorkflowStudio.vue so the sidebar (useSessions) can read the
// full set of stage-bound session IDs and filter them out of the main list —
// stage conversations are only reachable from the workflow track, never from
// the normal sidebar, so hiding them keeps the main list clean.
//
// Persisted to localStorage so bindings survive reloads.
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import type { StepName } from "../types/workflow";

const STAGE_SESSIONS_KEY = "specforge.workflow.stageSessions";

function load(): Record<string, Partial<Record<StepName, string>>> {
  try {
    return JSON.parse(localStorage.getItem(STAGE_SESSIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

// Module-level singleton — one registry for the whole app.
const stageSessions = ref<Record<string, Partial<Record<StepName, string>>>>(load());

function persist(): void {
  try {
    localStorage.setItem(STAGE_SESSIONS_KEY, JSON.stringify(stageSessions.value));
  } catch {
    // localStorage may be unavailable (private mode / quota); registry stays
    // in-memory only, which is degraded but non-fatal.
  }
}

/**
 * Every session ID currently bound to any stage of any workflow. The sidebar
 * uses this to绝对过滤 — those sessions never appear in the main list.
 */
const stageSessionIds = computed<Set<string>>(() => {
  const ids = new Set<string>();
  for (const key of Object.keys(stageSessions.value)) {
    const stages = stageSessions.value[key];
    if (!stages) continue;
    for (const stage of Object.keys(stages) as StepName[]) {
      const id = stages[stage];
      if (id) ids.add(id);
    }
  }
  return ids;
});

/** Read the session ID registered for a (workflowKey × stage) pair. */
function stageSessionId(workflowKey: string, stage: StepName): string | undefined {
  return stageSessions.value[workflowKey]?.[stage];
}

/** Bind a session ID to a (workflowKey × stage) pair and persist. */
function registerStageSession(workflowKey: string, stage: StepName, sessionId?: string): void {
  if (!sessionId) return;
  stageSessions.value = {
    ...stageSessions.value,
    [workflowKey]: {
      ...(stageSessions.value[workflowKey] ?? {}),
      [stage]: sessionId,
    },
  };
  persist();
}

/** Remove all stage bindings for a workflow key (and persist). */
function clearStageSessions(workflowKey: string): void {
  if (!stageSessions.value[workflowKey]) return;
  const next = { ...stageSessions.value };
  delete next[workflowKey];
  stageSessions.value = next;
  persist();
}

function reset(): void {
  stageSessions.value = {};
  persist();
}

/** All session IDs registered under a workflow key (any stage). */
function sessionsForWorkflow(workflowKey: string): string[] {
  const stages = stageSessions.value[workflowKey];
  if (!stages) return [];
  return (Object.keys(stages) as StepName[])
    .map((s) => stages[s])
    .filter((id): id is string => Boolean(id));
}

/**
 * Move all stage bindings from one workflow key to another — used when a draft
 * (`__draft__`) is promoted to a real changeId after the change is created.
 */
function migrateWorkflowKey(fromKey: string, toKey: string): void {
  const src = stageSessions.value[fromKey];
  if (!src || fromKey === toKey) return;
  const next = { ...stageSessions.value, [toKey]: { ...src } };
  delete next[fromKey];
  stageSessions.value = next;
  persist();
}

export function useStageSessions() {
  return {
    stageSessions,
    stageSessionIds,
    stageSessionId,
    registerStageSession,
    clearStageSessions,
    sessionsForWorkflow,
    migrateWorkflowKey,
    reset,
  };
}
