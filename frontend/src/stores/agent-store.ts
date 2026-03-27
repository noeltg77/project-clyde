import { createStore } from "zustand/vanilla";

export type AgentPlatform = "claude" | "gemini" | "openai";
export type ClaudeModel = "opus" | "sonnet" | "haiku";
export type GeminiModel = "gemini-pro" | "gemini-flash" | "gemini-lite";
export type OpenAIModel = "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano";
export type AgentModel = ClaudeModel | GeminiModel | OpenAIModel;

export type Agent = {
  registryId: string;
  name: string;
  role: string;
  platform: AgentPlatform;
  model: AgentModel;
  avatar: string;
  status: "active" | "paused" | "archived";
  tools: string[];
  skills: string[];
  team: string | null;
};

export type Team = {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
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
  modelTier: AgentModel;
  timestamp: string;
  /** Session this permission belongs to — used for routing responses to the correct WebSocket */
  sessionId?: string;
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
  teams: Team[];
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
  removeAgent: (registryId: string) => void;
  setTeams: (teams: Team[]) => void;
  updateTeam: (teamId: string, partial: Partial<Team>) => void;
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
    teams: [],
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

    removeAgent: (registryId) =>
      set((state) => ({
        agents: state.agents.filter((a) => a.registryId !== registryId),
      })),

    setTeams: (teams) => set({ teams }),

    updateTeam: (teamId, partial) =>
      set((state) => ({
        teams: state.teams.map((t) =>
          t.id === teamId ? { ...t, ...partial } : t
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
