import { createStore } from "zustand/vanilla";

export type Agent = {
  registryId: string;
  name: string;
  role: string;
  model: "opus" | "sonnet" | "haiku";
  avatar: string;
  status: "active" | "paused" | "archived";
  tools: string[];
  skills: string[];
};

export type ActivityEvent = {
  id: string;
  agentId: string;
  agentName: string;
  eventType:
    | "started"
    | "stopped"
    | "tool_use"
    | "permission_request"
    | "created"
    | "error";
  description: string;
  timestamp: string;
  parentAgent?: string;
  isTeamMember?: boolean;
};

export type PendingPermission = {
  id: string;
  toolName: string;
  toolInput: Record<string, string>;
  agentName: string;
  modelTier: "opus" | "sonnet" | "haiku";
  timestamp: string;
};

export type ActiveAgentMeta = {
  name: string;
  model?: Agent["model"];
  avatar?: string;
  role?: string;
};

export type AgentState = {
  orchestrator: Agent | null;
  agents: Agent[];
  activityEvents: ActivityEvent[];
  pendingPermissions: PendingPermission[];
  activeAgentIds: string[];
  activeAgentMeta: Record<string, ActiveAgentMeta>;
};

export type AgentActions = {
  setOrchestrator: (agent: Agent) => void;
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (registryId: string, partial: Partial<Agent>) => void;
  addActivityEvent: (event: ActivityEvent) => void;
  setActivityEvents: (events: ActivityEvent[]) => void;
  clearActivityEvents: () => void;
  addPendingPermission: (perm: PendingPermission) => void;
  removePendingPermission: (id: string) => void;
  setAgentActive: (id: string, active: boolean, meta?: ActiveAgentMeta) => void;
  clearActiveAgents: () => void;
};

export type AgentStore = AgentState & AgentActions;

export const createAgentStore = (initState?: Partial<AgentState>) =>
  createStore<AgentStore>()((set) => ({
    orchestrator: null,
    agents: [],
    activityEvents: [],
    pendingPermissions: [],
    activeAgentIds: [],
    activeAgentMeta: {},
    ...initState,

    setOrchestrator: (agent) => set({ orchestrator: agent }),

    setAgents: (agents) => set({ agents }),

    addAgent: (agent) =>
      set((state) => ({
        agents: [...state.agents.filter((a) => a.registryId !== agent.registryId), agent],
      })),

    updateAgent: (registryId, partial) =>
      set((state) => ({
        agents: state.agents.map((a) =>
          a.registryId === registryId ? { ...a, ...partial } : a
        ),
      })),

    addActivityEvent: (event) =>
      set((state) => ({
        activityEvents: [event, ...state.activityEvents].slice(0, 100), // Keep last 100
      })),

    setActivityEvents: (events) => set({ activityEvents: events }),

    clearActivityEvents: () => set({ activityEvents: [] }),

    addPendingPermission: (perm) =>
      set((state) => ({
        pendingPermissions: [...state.pendingPermissions, perm],
      })),

    removePendingPermission: (id) =>
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.id !== id),
      })),

    setAgentActive: (id, active, meta?) =>
      set((state) => {
        if (active) {
          const nextMeta = { ...state.activeAgentMeta };
          if (meta) nextMeta[id] = meta;
          return {
            activeAgentIds: [...state.activeAgentIds.filter((aid) => aid !== id), id],
            activeAgentMeta: nextMeta,
          };
        }
        return {
          activeAgentIds: state.activeAgentIds.filter((aid) => aid !== id),
          // Keep meta around briefly so the completing animation can still read it
        };
      }),

    clearActiveAgents: () => set({ activeAgentIds: [], activeAgentMeta: {} }),
  }));
