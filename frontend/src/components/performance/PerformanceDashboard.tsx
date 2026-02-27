"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type AgentPerf = {
  agent_name: string;
  tasks: number;
  success_rate: number;
  positive_feedback: number;
  negative_feedback: number;
  avg_completion_ms: number;
};

type PerfData = {
  total_tasks: number;
  total_agents: number;
  overall_success_rate: number;
  avg_completion_ms: number;
  by_agent: AgentPerf[];
};

export function PerformanceDashboard() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPerf() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/performance`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Failed to fetch performance data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchPerf();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-40 bg-bg-tertiary animate-pulse rounded-[2px]" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 bg-bg-tertiary animate-pulse rounded-[2px]"
              />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2].map((i) => (
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

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-text-secondary/50">
          Unable to load performance data
        </p>
      </div>
    );
  }

  // Filter out rogue hex-ID entries from agent stats
  const isHexId = (name: string) => /^[0-9a-f]{6,}$/i.test(name);
  const cleanAgents = data.by_agent.filter((a) => !isHexId(a.agent_name));

  // Recompute summary stats from clean data
  const totalTasks = cleanAgents.reduce((sum, a) => sum + a.tasks, 0);
  const totalAgents = cleanAgents.length;
  const overallSuccessRate =
    totalTasks > 0
      ? Math.round(
          (cleanAgents.reduce((sum, a) => sum + a.success_rate * a.tasks, 0) /
            totalTasks) *
            10
        ) / 10
      : 0;
  const avgCompletionMs =
    totalTasks > 0
      ? cleanAgents.reduce((sum, a) => sum + a.avg_completion_ms * a.tasks, 0) /
        totalTasks
      : 0;
  const avgTimeSeconds = avgCompletionMs
    ? (avgCompletionMs / 1000).toFixed(1)
    : "0";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-text-primary font-display">
            Performance
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Summary cards — 4 in a row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Tasks" value={String(totalTasks)} />
            <StatCard
              label="Success Rate"
              value={`${overallSuccessRate}%`}
              accent={overallSuccessRate >= 80}
            />
            <StatCard
              label="Avg Time"
              value={`${avgTimeSeconds}s`}
            />
            <StatCard
              label="Active Agents"
              value={String(totalAgents)}
            />
          </div>

          {/* Per-agent breakdown */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-3">
              By Agent
            </h3>
            {data.by_agent.length === 0 ? (
              <p className="text-sm text-text-secondary/40 text-center py-8">
                No performance data yet
              </p>
            ) : (
              <div className="space-y-2">
                {cleanAgents.map((agent) => (
                  <AgentPerfRow key={agent.agent_name} agent={agent} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-bg-tertiary p-4 rounded-[2px] border border-border">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
        {label}
      </p>
      <p
        className={`text-2xl font-mono font-bold mt-1 ${
          accent ? "text-accent-primary" : "text-text-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function AgentPerfRow({ agent }: { agent: AgentPerf }) {
  const feedbackScore =
    agent.positive_feedback + agent.negative_feedback > 0
      ? Math.round(
          (agent.positive_feedback /
            (agent.positive_feedback + agent.negative_feedback)) *
            100
        )
      : null;

  const avgTimeSec = agent.avg_completion_ms
    ? (agent.avg_completion_ms / 1000).toFixed(1)
    : "—";

  const successColor =
    agent.success_rate >= 80
      ? "text-accent-tertiary"
      : agent.success_rate >= 50
      ? "text-yellow-500"
      : "text-error";

  const barColor =
    agent.success_rate >= 80
      ? "bg-accent-tertiary"
      : agent.success_rate >= 50
      ? "bg-yellow-500"
      : "bg-error";

  return (
    <div className="px-4 py-3.5 bg-bg-tertiary rounded-[2px] border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-text-primary">
          {agent.agent_name}
        </span>
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-text-secondary/50 font-mono">
            {agent.tasks} task{agent.tasks !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-text-secondary/50">
            {avgTimeSec}s avg
          </span>
          {feedbackScore !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-secondary/50">
                {agent.positive_feedback}
              </span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-accent-tertiary/60"
              >
                <path d="M2 20h2V8H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 0 7.59 5.59C7.22 5.95 7 6.45 7 7v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
              </svg>
              <span className="text-[11px] text-text-secondary/50">
                {agent.negative_feedback}
              </span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-error/60"
              >
                <path d="M22 4h-2v12h2V4zm-4 12V4c0-1.1-.9-2-2-2H7c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L10.83 24l5.58-5.59c.36-.36.59-.86.59-1.41z" />
              </svg>
            </div>
          )}
          <span className={`text-sm font-mono font-semibold ${successColor}`}>
            {agent.success_rate}%
          </span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${agent.success_rate}%` }}
        />
      </div>
    </div>
  );
}
