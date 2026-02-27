"use client";

import { motion } from "motion/react";
import { springs } from "@/lib/design-tokens";
import type { Insight, InsightSeverity } from "@/stores/insight-store";

type InsightAction = "dismiss" | "snooze" | "act";

type InsightCardProps = {
  insight: Insight;
  onAction: (id: string, action: InsightAction) => void;
};

const severityConfig: Record<
  InsightSeverity,
  { color: string; border: string; shadow: string; label: string }
> = {
  info: {
    color: "text-accent-tertiary",
    border: "border-accent-tertiary/40",
    shadow: "shadow-[4px_4px_0_0_rgba(0,212,170,0.15)]",
    label: "Insight",
  },
  warning: {
    color: "text-accent-secondary",
    border: "border-accent-secondary/40",
    shadow: "shadow-[4px_4px_0_0_rgba(255,107,53,0.15)]",
    label: "Warning",
  },
  action_required: {
    color: "text-accent-primary",
    border: "border-accent-primary/40",
    shadow: "shadow-[4px_4px_0_0_rgba(200,255,0,0.15)]",
    label: "Action Required",
  },
};

export function InsightCard({ insight, onAction }: InsightCardProps) {
  const config = severityConfig[insight.severity];
  const agentName = insight.data?.agent_name as string | undefined;
  const metricDetail = insight.data?.pattern as string | undefined;
  const frequency = insight.data?.frequency as number | undefined;

  return (
    <motion.div
      layout
      initial={{ x: "-100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-100%", opacity: 0 }}
      transition={springs.snappy}
      className={`w-[340px] bg-bg-secondary border-2 ${config.border} rounded-[2px] ${config.shadow} overflow-hidden`}
    >
      {/* Severity accent left bar */}
      <div className="flex">
        <div
          className={`w-1 shrink-0 ${
            insight.severity === "info"
              ? "bg-accent-tertiary"
              : insight.severity === "warning"
              ? "bg-accent-secondary"
              : "bg-accent-primary"
          }`}
        />

        <div className="flex-1 p-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              {/* Lightbulb icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 ${config.color}`}
              >
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
              </svg>
              <span className="text-sm font-medium text-text-primary truncate">
                {insight.title}
              </span>
            </div>

            {/* Dismiss X */}
            <button
              onClick={() => onAction(insight.id, "dismiss")}
              className="shrink-0 p-0.5 text-text-secondary/40 hover:text-text-secondary transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Description */}
          <p className="text-[11px] text-text-secondary leading-relaxed mb-2">
            {insight.description}
          </p>

          {/* Metadata line */}
          {(agentName || metricDetail) && (
            <div className="flex items-center gap-2 mb-2.5">
              {agentName && (
                <span className="text-[10px] font-mono text-text-secondary/60">
                  {agentName}
                </span>
              )}
              {agentName && metricDetail && (
                <span className="text-text-secondary/20">—</span>
              )}
              {metricDetail && (
                <span className="text-[10px] font-mono text-text-secondary/50">
                  &quot;{metricDetail}&quot;
                  {frequency ? ` × ${frequency}` : ""}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => onAction(insight.id, "snooze")}
              className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 hover:text-text-secondary transition-colors"
            >
              Snooze 24h
            </button>
            <button
              onClick={() => onAction(insight.id, "act")}
              className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] transition-all hover:brightness-110 ${
                insight.severity === "action_required"
                  ? "bg-accent-primary text-bg-primary"
                  : insight.severity === "warning"
                  ? "bg-accent-secondary text-bg-primary"
                  : "bg-accent-tertiary text-bg-primary"
              }`}
            >
              Act on this
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
