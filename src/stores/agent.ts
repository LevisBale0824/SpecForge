import { create } from "zustand";
import { AgentRegistry } from "../agents/registry";
import { AgentAdapter } from "../agents/types";

interface AgentState {
  registry: AgentRegistry;
  activeAgent: AgentAdapter | null;
  isAvailable: boolean;
}

interface AgentActions {
  initialize: (agents: AgentAdapter[], activeName: string) => void;
  setActive: (name: string) => void;
  checkAvailability: () => Promise<void>;
}

export const useAgentStore = create<AgentState & AgentActions>()((set, get) => ({
  registry: new AgentRegistry(),
  activeAgent: null,
  isAvailable: false,

  initialize: (agents, activeName) => {
    const registry = new AgentRegistry();
    for (const agent of agents) { registry.register(agent); }
    registry.setActive(activeName);
    set({ registry, activeAgent: registry.getActive() || null });
  },

  setActive: (name) => {
    const { registry } = get();
    registry.setActive(name);
    set({ activeAgent: registry.getActive() || null });
  },

  checkAvailability: async () => {
    const { activeAgent } = get();
    if (!activeAgent) { set({ isAvailable: false }); return; }
    const available = await activeAgent.isAvailable();
    set({ isAvailable: available });
  },
}));
