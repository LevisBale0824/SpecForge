// ---------------------------------------------------------------------------
// Agents Store
// ---------------------------------------------------------------------------
// Reactive cache of backend agents from `adapter.listAgents()`. Exposes
// `selectableAgents` — only `mode==="primary"` agents that are not hidden,
// suitable for driving an AgentPicker dropdown.
//
// Reset on backend switch or disconnect; refreshed when the connection
// becomes "ready" (see useBackend.ts wiring, parallel to useModels).
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import { getActiveBackendAdapter } from "../backends/registry";
import type { BackendAgentInfo } from "../types/backend-domain";

export type AvailableAgent = {
  name: string;
  description: string;
  mode: string;
  native: boolean;
  color: string | null;
};

const agents = ref<BackendAgentInfo[]>([]);

// Only primary, non-hidden agents are user-selectable as the main agent.
// Subagents are internal (invoked by primary agents via task()) and shouldn't
// appear in the picker.
const selectableAgents = computed<AvailableAgent[]>(() => {
  const out: AvailableAgent[] = [];
  for (const a of agents.value) {
    if (!a?.name) continue;
    if (a.hidden === true) continue;
    if (a.mode && a.mode !== "primary") continue;
    out.push({
      name: a.name,
      description: a.description ?? "",
      mode: a.mode ?? "primary",
      native: a.native === true,
      color: a.color ?? null,
    });
  }
  return out;
});

function applyRaw(list: BackendAgentInfo[] | null | undefined): void {
  agents.value = Array.isArray(list) ? list : [];
}

async function refreshAgents(): Promise<void> {
  try {
    const adapter = getActiveBackendAdapter();
    if (!adapter.listAgents) return;
    const raw = (await adapter.listAgents()) as BackendAgentInfo[] | undefined;
    applyRaw(raw ?? []);
  } catch (error) {
    console.error("[useAgents] refreshAgents failed:", error);
  }
}

function resetAgents(): void {
  applyRaw(null);
}

export function useAgents() {
  return {
    agents,
    selectableAgents,
    refreshAgents,
    resetAgents,
  };
}
