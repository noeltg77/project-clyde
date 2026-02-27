"use client";

import { useEffect, useState } from "react";
import type {
  Insight,
  InsightSeverity,
  InsightStatus,
} from "@/stores/insight-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FilterTab = "all" | "pending" | "acted_upon" | "dismissed";

const severityColors: Record<InsightSeverity, string> = {
  info: "text-accent-tertiary",
  warning: "text-accent-secondary",
  action_required: "text-accent-primary",
};

const statusBadge: Record<
  InsightStatus,
  { bg: string; text: string; label: string }
> = {
  pending: {
    bg: "bg-accent-tertiary/10 border border-accent-tertiary/30",
    text: "text-accent-tertiary",
    label: "Pending",
  },
  dismissed: {
    bg: "bg-bg-tertiary border border-border",
    text: "text-text-secondary/50",
    label: "Dismissed",
  },
  snoozed: {
    bg: "bg-accent-secondary/10 border border-accent-secondary/30",
    text: "text-accent-secondary",
    label: "Snoozed",
  },
  acted_upon: {
    bg: "bg-accent-tertiary/20 border border-accent-tertiary/40",
    text: "text-accent-tertiary",
    label: "Acted",
  },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type RawInsight = {
  id: string;
  insight_type: string;
  title: string;
  description: string;
  severity: string;
  data: Record<string, unknown>;
  status: string;
  snoozed_until?: string;
  created_at: string;
};

export function InsightsDashboard() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInsights() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/insights`);
        const data = await res.json();
        if (data.insights) {
          setInsights(
            data.insights.map((i: RawInsight) => ({
              id: i.id,
              insightType: i.insight_type as Insight["insightType"],
              title: i.title,
              description: i.description,
              severity: i.severity as Insight["severity"],
              data: i.data || {},
              status: i.status as Insight["status"],
              snoozedUntil: i.snoozed_until,
              createdAt: i.created_at,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to fetch insights:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();
  }, []);

  const filtered =
    filter === "all"
      ? insights
      : insights.filter((i) => i.status === filter);

  const handleAction = async (
    id: string,
    action: "dismiss" | "snooze" | "act" | "undo"
  ) => {
    // Show loading state for "act" actions
    if (action === "act") {
      setActingId(id);
    }

    const status =
      action === "dismiss"
        ? "dismissed"
        : action === "snooze"
        ? "snoozed"
        : action === "undo"
        ? "pending"
        : "acted_upon";
    try {
      await fetch(`${API_URL}/api/insights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(action === "snooze"
            ? {
                snoozed_until: new Date(
                  Date.now() + 24 * 60 * 60 * 1000
                ).toISOString(),
              }
            : {}),
        }),
      });
      // Update local state
      setInsights((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: status as Insight["status"] } : i
        )
      );

      // For "act" — dispatch the routing event so ChatContainer picks it up
      if (action === "act") {
        const insight = insights.find((i) => i.id === id);
        if (insight) {
          window.dispatchEvent(
            new CustomEvent("insight-action", {
              detail: { id, action: "act", insight },
            })
          );
        }
      }
    } catch (err) {
      console.error("Failed to update insight:", err);
      if (action === "act") setActingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/insights/${id}`, { method: "DELETE" });
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Failed to delete insight:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-32 bg-bg-tertiary animate-pulse rounded-[2px]" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-bg-tertiary animate-pulse rounded-[2px]"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header + Filter tabs */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary font-display">
              Insights
            </h2>
            <span className="text-[11px] text-text-secondary/40">
              {insights.filter((i) => i.status === "pending").length} pending
            </span>
          </div>

          {/* Filter tabs — pill buttons */}
          <div className="flex gap-2">
            {(["all", "pending", "acted_upon", "dismissed"] as FilterTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] transition-colors ${
                    filter === tab
                      ? "bg-accent-primary text-bg-primary"
                      : "text-text-secondary/50 hover:text-text-secondary hover:bg-bg-tertiary border border-border"
                  }`}
                >
                  {tab === "acted_upon" ? "Acted" : tab}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Insight list */}
      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-2">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-text-secondary/50">
                {filter === "all"
                  ? "No insights yet. They'll appear here after Clyde's next analysis run."
                  : `No ${filter === "acted_upon" ? "acted" : filter} insights.`}
              </p>
            </div>
          )}

          {filtered.map((insight) => {
            const isExpanded = expandedId === insight.id;
            const badge = statusBadge[insight.status];
            const sevColor = severityColors[insight.severity];

            return (
              <div
                key={insight.id}
                className="rounded-[2px] bg-bg-tertiary border border-border overflow-hidden"
              >
                {/* Row header */}
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : insight.id)
                  }
                  className="w-full text-left px-5 py-4 flex items-start gap-3"
                >
                  {/* Severity icon */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 mt-0.5 ${sevColor}`}
                  >
                    <path d="M9 18h6" />
                    <path d="M10 22h4" />
                    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
                  </svg>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <p className="text-sm font-medium text-text-primary">
                        {insight.title}
                      </p>
                      <span
                        className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    {/* Show description inline (not just when expanded) */}
                    <p className="text-[12px] text-text-secondary/60 line-clamp-2">
                      {insight.description}
                    </p>
                    <span className="text-[10px] text-text-secondary/40 mt-1 inline-block">
                      {timeAgo(insight.createdAt)}
                    </span>
                  </div>

                  {/* Expand chevron */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`shrink-0 mt-1 text-text-secondary/30 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-0 border-t border-border/50">
                    <p className="text-sm text-text-secondary leading-relaxed mt-3 mb-4">
                      {insight.description}
                    </p>

                    {/* Action buttons for pending insights */}
                    {insight.status === "pending" && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleAction(insight.id, "dismiss")}
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 hover:text-text-secondary border border-border rounded-[2px] hover:bg-bg-secondary transition-colors"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => handleAction(insight.id, "snooze")}
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 hover:text-text-secondary border border-border rounded-[2px] hover:bg-bg-secondary transition-colors"
                        >
                          Snooze 24h
                        </button>
                        <button
                          onClick={() => handleAction(insight.id, "act")}
                          disabled={actingId === insight.id}
                          className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] transition-all ml-auto ${
                            actingId === insight.id
                              ? "bg-accent-primary/80 text-bg-primary animate-pulse cursor-wait"
                              : "bg-accent-tertiary text-bg-primary hover:brightness-110"
                          }`}
                        >
                          {actingId === insight.id
                            ? "Sending to Clyde..."
                            : "Act on this"}
                        </button>
                      </div>
                    )}

                    {/* Action buttons for dismissed insights */}
                    {insight.status === "dismissed" && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleAction(insight.id, "undo")}
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 hover:text-text-secondary border border-border rounded-[2px] hover:bg-bg-secondary transition-colors flex items-center gap-1.5"
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                          Undo Dismiss
                        </button>
                        <button
                          onClick={() => handleDelete(insight.id)}
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-error/70 hover:text-error border border-error/20 rounded-[2px] hover:bg-error/5 transition-colors flex items-center gap-1.5 ml-auto"
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
