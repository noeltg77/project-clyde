import { createStore } from "zustand/vanilla";

export type MessageStep = {
  type: "tool_use" | "agent_started" | "agent_stopped" | "text";
  label: string;
  detail?: string;
  timestamp: string;
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
  isStreaming: boolean;
  isLoadingSession: boolean;
  error: string | null;
};

export type ChatActions = {
  setSessionId: (id: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  appendToMessage: (id: string, textDelta: string) => void;
  addStepToMessage: (id: string, step: MessageStep) => void;
  setConnected: (connected: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  setSessions: (sessions: SessionSummary[]) => void;
  addSession: (session: SessionSummary) => void;
  removeSession: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
  setLoadingSession: (loading: boolean) => void;
  setMessages: (messages: Message[]) => void;
};

export type ChatStore = ChatState & ChatActions;

export const createChatStore = (initState?: Partial<ChatState>) =>
  createStore<ChatStore>()((set) => ({
    sessionId: null,
    messages: [],
    sessions: [],
    isConnected: false,
    isStreaming: false,
    isLoadingSession: false,
    error: null,
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
    setConnected: (connected) => set({ isConnected: connected }),
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
  }));
