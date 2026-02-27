"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type CostData = {
  today_usd: number;
  week_usd: number;
  month_usd: number;
  by_agent: {
    name: string;
    cost_usd: number;
    message_count: number;
  }[];
  daily_breakdown: {
    date: string;
    cost_usd: number;
  }[];
};

export function CostDashboard() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCost() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/cost`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Failed to fetch cost data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCost();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-32 bg-bg-tertiary animate-pulse rounded-[2px]" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 bg-bg-tertiary animate-pulse rounded-[2px]"
              />
            ))}
          </div>
          <div className="h-64 bg-bg-tertiary animate-pulse rounded-[2px]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-text-secondary/50">
          Unable to load cost data
        </p>
      </div>
    );
  }

  // Format daily chart data — show short day labels
  const chartData = data.daily_breakdown.map((d) => {
    const date = new Date(d.date);
    return {
      label: date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
      cost: d.cost_usd,
    };
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-text-primary font-display">
            Cost Tracking
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <CostCard label="Today" value={data.today_usd} />
            <CostCard label="This Week" value={data.week_usd} />
            <CostCard label="This Month" value={data.month_usd} />
          </div>

          {/* Daily chart */}
          <div className="bg-bg-tertiary p-5 rounded-[2px] border border-border">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-4">
              Last 14 Days
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.3)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.3)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#141414",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "2px",
                      fontSize: 12,
                      color: "#C8FF00",
                    }}
                    formatter={(value?: number) => [
                      `$${(value ?? 0).toFixed(4)}`,
                      "Cost",
                    ]}
                    labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                  />
                  <Bar
                    dataKey="cost"
                    fill="#C8FF00"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agent breakdown — full table layout */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-3">
              By Agent
            </h3>
            {data.by_agent.length === 0 ? (
              <p className="text-sm text-text-secondary/40 text-center py-8">
                No cost data yet
              </p>
            ) : (
              <div className="bg-bg-tertiary rounded-[2px] border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                        Agent
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                        Messages
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                        Cost
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                        Per Msg
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_agent
                      .filter((a) => !/^[0-9a-f]{6,}$/i.test(a.name))
                      .map((agent) => (
                      <tr
                        key={agent.name}
                        className="border-b border-border/50 last:border-b-0 hover:bg-bg-secondary/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-text-primary">
                          {agent.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary/60 text-right font-mono">
                          {agent.message_count}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-accent-primary text-right">
                          ${agent.cost_usd.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-text-secondary/40 text-right font-mono">
                          {agent.message_count > 0
                            ? `$${(agent.cost_usd / agent.message_count).toFixed(4)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Currency footer */}
          <p className="text-[10px] text-text-secondary/30 text-center">
            All costs in USD
          </p>
        </div>
      </div>
    </div>
  );
}

function CostCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg-tertiary p-4 rounded-[2px] border border-border">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
        {label}
      </p>
      <p className="text-2xl font-mono font-bold text-accent-primary mt-1">
        ${value.toFixed(2)}
      </p>
    </div>
  );
}
