import { createStore } from "zustand/vanilla";

export type InsightType =
  | "agent_suggestion"
  | "workflow_optimisation"
  | "agent_archival"
  | "performance_trend"
  | "usage_pattern";

export type InsightSeverity = "info" | "warning" | "action_required";

export type InsightStatus = "pending" | "dismissed" | "snoozed" | "acted_upon";

export type Insight = {
  id: string;
  insightType: InsightType;
  title: string;
  description: string;
  severity: InsightSeverity;
  data: Record<string, unknown>;
  status: InsightStatus;
  snoozedUntil?: string;
  createdAt: string;
};

export type InsightState = {
  insights: Insight[];
  pendingCount: number;
};

export type InsightActions = {
  setInsights: (insights: Insight[]) => void;
  addInsight: (insight: Insight) => void;
  updateInsightStatus: (id: string, status: InsightStatus) => void;
  removeInsight: (id: string) => void;
};

export type InsightStore = InsightState & InsightActions;

export const createInsightStore = (initState?: Partial<InsightState>) =>
  createStore<InsightStore>()((set) => ({
    insights: [],
    pendingCount: 0,
    ...initState,

    setInsights: (insights) =>
      set({
        insights,
        pendingCount: insights.filter((i) => i.status === "pending").length,
      }),

    addInsight: (insight) =>
      set((state) => {
        // Prevent duplicates
        const existing = state.insights.find((i) => i.id === insight.id);
        if (existing) return state;
        const updated = [insight, ...state.insights];
        return {
          insights: updated,
          pendingCount: updated.filter((i) => i.status === "pending").length,
        };
      }),

    updateInsightStatus: (id, status) =>
      set((state) => {
        const updated = state.insights.map((i) =>
          i.id === id ? { ...i, status } : i
        );
        return {
          insights: updated,
          pendingCount: updated.filter((i) => i.status === "pending").length,
        };
      }),

    removeInsight: (id) =>
      set((state) => {
        const updated = state.insights.filter((i) => i.id !== id);
        return {
          insights: updated,
          pendingCount: updated.filter((i) => i.status === "pending").length,
        };
      }),
  }));
