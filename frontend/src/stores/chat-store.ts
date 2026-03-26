import { createStore } from "zustand/vanilla";

export type MessageStep = {
  type: "tool_use" | "agent_started" | "agent_stopped" | "text";
  label: string;
  detail?: string;
  timestamp: string;
};

export type AgentActivityStatus = {
  phase: "working" | "complete";
  agentId: string;
  tokenCount?: number;
  durationMs?: number;
};

export type VisualizationData = {
  id: string;
  title: string;
  htmlContent: string;
  description?: string;
};

export type VisualConfig = {
  id: string;
  title: string;
  mode: "chart" | "code";
  chartType?: string;
  data?: Record<string, unknown>;
  options?: Record<string, unknown>;
  code?: string;
  description?: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: "user" | "clyde" | "agent";
  agentName?: string;
  agentAvatar?: string;
  content: string;
  tokenCount?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  isStreaming?: boolean;
  steps?: MessageStep[];
  debugPrompts?: { systemPrompt: string; userMessage: string };
  activityStatus?: AgentActivityStatus;
  visualizations?: VisualizationData[];
  visuals?: VisualConfig[];
};

export type SessionSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastMessagePreview: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
};

export type ChatState = {
  sessionId: string | null;
  messages: Message[];
  sessions: SessionSummary[];
  isConnected: boolean;
  isInitialLoad: boolean;
  isStreaming: boolean;
  isLoadingSession: boolean;
  error: string | null;
  /** Tracks which sessions are actively streaming on the backend */
  streamingSessions: Record<string, boolean>;
};

export type ChatActions = {
  setSessionId: (id: string | null) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  appendToMessage: (id: string, textDelta: string) => void;
  addStepToMessage: (id: string, step: MessageStep) => void;
  addVisualizationToMessage: (id: string, viz: VisualizationData) => void;
  addVisualToMessage: (id: string, vis: VisualConfig) => void;
  setConnected: (connected: boolean) => void;
  setInitialLoadDone: () => void;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  setSessions: (sessions: SessionSummary[]) => void;
  addSession: (session: SessionSummary) => void;
  removeSession: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
  setLoadingSession: (loading: boolean) => void;
  setMessages: (messages: Message[]) => void;
  /** Track streaming state for a specific session (independent of active view) */
  setSessionStreaming: (sessionId: string, streaming: boolean) => void;
};

export type ChatStore = ChatState & ChatActions;

export const createChatStore = (initState?: Partial<ChatState>) =>
  createStore<ChatStore>()((set) => ({
    sessionId: null,
    messages: [],
    sessions: [],
    isConnected: false,
    isInitialLoad: true,
    isStreaming: false,
    isLoadingSession: false,
    error: null,
    streamingSessions: {},
    ...initState,
    setSessionId: (id) => set({ sessionId: id }),
    addMessage: (message) =>
      set((state) => ({ messages: [...state.messages, message] })),
    updateMessage: (id, partial) =>
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, ...partial } : m
        ),
      })),
    appendToMessage: (id, textDelta) =>
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, content: m.content + textDelta } : m
        ),
      })),
    addStepToMessage: (id, step) =>
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id
            ? { ...m, steps: [...(m.steps || []), step] }
            : m
        ),
      })),
    addVisualizationToMessage: (id, viz) =>
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id
            ? { ...m, visualizations: [...(m.visualizations || []), viz] }
            : m
        ),
      })),
    addVisualToMessage: (id, vis) =>
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id
            ? { ...m, visuals: [...(m.visuals || []), vis] }
            : m
        ),
      })),
    setConnected: (connected) => set({ isConnected: connected }),
    setInitialLoadDone: () => set({ isInitialLoad: false }),
    setStreaming: (streaming) => set({ isStreaming: streaming }),
    setError: (error) => set({ error }),
    clearMessages: () => set({ messages: [] }),
    setSessions: (sessions) => set({ sessions }),
    addSession: (session) =>
      set((state) => ({ sessions: [session, ...state.sessions] })),
    removeSession: (id) =>
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
      })),
    updateSessionTitle: (id, title) =>
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, title } : s
        ),
      })),
    setLoadingSession: (loading) => set({ isLoadingSession: loading }),
    setMessages: (messages) => set({ messages }),
    setSessionStreaming: (sessionId, streaming) =>
      set((state) => {
        const updated = { ...state.streamingSessions };
        if (streaming) {
          updated[sessionId] = true;
        } else {
          delete updated[sessionId];
        }
        return {
          streamingSessions: updated,
          // Sync isStreaming if this is the currently viewed session
          ...(state.sessionId === sessionId ? { isStreaming: streaming } : {}),
        };
      }),
  }));
