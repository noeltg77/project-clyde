"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type CostData = {
  today_usd: number;
  week_usd: number;
  month_usd: number;
  range_usd: number;
  by_agent: {
    name: string;
    cost_usd: number;
    message_count: number;
  }[];
  by_platform?: {
    platform: string;
    cost_usd: number;
    message_count: number;
  }[];
  daily_breakdown: {
    date: string;
    cost_usd: number;
    claude?: number;
    gemini?: number;
    openai?: number;
    openrouter?: number;
  }[];
};

type DateRange = {
  label: string;
  days?: number;
  rangeType?: string;
};

const DATE_RANGES: DateRange[] = [
  { label: "7 Days", days: 7 },
  { label: "14 Days", days: 14 },
  { label: "30 Days", days: 30 },
  { label: "Month to Date", rangeType: "mtd" },
  { label: "3 Months", days: 90 },
  { label: "6 Months", days: 180 },
  { label: "Year", days: 365 },
  { label: "Year to Date", rangeType: "ytd" },
];

const PLATFORM_COLOURS: Record<string, string> = {
  claude: "#C8FF00",
  gemini: "#4285F4",
  openai: "#10A37F",
  openrouter: "#B066FF",
};

const PLATFORM_LABELS: Record<string, string> = {
  claude: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export function CostDashboard() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState(1); // default: 14 Days

  const fetchCost = useCallback(async (range: DateRange) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (range.rangeType) {
        params.set("range_type", range.rangeType);
      } else if (range.days) {
        params.set("days", String(range.days));
      }
      const res = await fetch(`${API_URL}/api/cost?${params.toString()}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch cost data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCost(DATE_RANGES[selectedRange]);
  }, [selectedRange, fetchCost]);

  const handleRangeChange = (index: number) => {
    setSelectedRange(index);
  };

  if (loading && !data) {
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

  const currentRange = DATE_RANGES[selectedRange];

  // Determine which platforms have data for the stacked chart
  const hasClaude = data.daily_breakdown.some((d) => (d.claude ?? 0) > 0);
  const hasGemini = data.daily_breakdown.some((d) => (d.gemini ?? 0) > 0);
  const hasOpenAI = data.daily_breakdown.some((d) => (d.openai ?? 0) > 0);
  const hasOpenRouter = data.daily_breakdown.some((d) => (d.openrouter ?? 0) > 0);
  const hasAnyPlatform = hasClaude || hasGemini || hasOpenAI || hasOpenRouter;

  // For year/ytd ranges, aggregate daily data into monthly buckets
  const useMonthly =
    currentRange.days === 365 || currentRange.rangeType === "ytd";

  const chartData = (() => {
    if (useMonthly) {
      const monthMap: Record<
        string,
        { cost: number; claude: number; gemini: number; openai: number }
      > = {};
      for (const d of data.daily_breakdown) {
        const monthKey = d.date.slice(0, 7); // "YYYY-MM"
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = { cost: 0, claude: 0, gemini: 0, openai: 0 };
        }
        monthMap[monthKey].cost += d.cost_usd;
        monthMap[monthKey].claude += d.claude ?? 0;
        monthMap[monthKey].gemini += d.gemini ?? 0;
        monthMap[monthKey].openai += d.openai ?? 0;
      }
      return Object.entries(monthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, vals]) => {
          const [year, month] = key.split("-");
          const date = new Date(Number(year), Number(month) - 1);
          return {
            label: date.toLocaleDateString("en-GB", {
              month: "short",
              year: "2-digit",
            }),
            cost: vals.cost,
            claude: vals.claude,
            gemini: vals.gemini,
            openai: vals.openai,
          };
        });
    }

    // Daily view — short day labels
    return data.daily_breakdown.map((d) => {
      const date = new Date(d.date);
      return {
        label: date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        cost: d.cost_usd,
        claude: d.claude ?? 0,
        gemini: d.gemini ?? 0,
        openai: d.openai ?? 0,
      };
    });
  })();

  // Build platform rows for the table
  const platformRows = (data.by_platform ?? []).map((p) => ({
    name: PLATFORM_LABELS[p.platform] ?? p.platform,
    platform: p.platform,
    cost_usd: p.cost_usd,
    message_count: p.message_count,
    colour: PLATFORM_COLOURS[p.platform] ?? "#888",
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with date range selector */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary font-display">
              Cost Tracking
            </h2>
          </div>
          {/* Date range selector */}
          <div className="flex flex-wrap gap-1.5">
            {DATE_RANGES.map((range, idx) => (
              <button
                key={range.label}
                onClick={() => handleRangeChange(idx)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-[2px] transition-colors ${
                  selectedRange === idx
                    ? "bg-accent-primary text-bg-primary"
                    : "bg-bg-tertiary text-text-secondary/60 hover:text-text-secondary hover:bg-bg-tertiary/80 border border-border"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-6 pt-4 ${loading ? "opacity-50 pointer-events-none" : ""} transition-opacity`}>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <CostCard label="Today" value={data.today_usd} />
            <CostCard label="This Week" value={data.week_usd} />
            <CostCard
              label={currentRange.label}
              value={data.range_usd}
              highlight
            />
          </div>

          {/* Platform breakdown cards */}
          {data.by_platform && data.by_platform.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-3">
                By Platform ({currentRange.label})
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {data.by_platform.map((p) => (
                  <div
                    key={p.platform}
                    className="bg-bg-tertiary p-4 rounded-[2px] border border-border"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            PLATFORM_COLOURS[p.platform] ?? "#888",
                        }}
                      />
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
                        {PLATFORM_LABELS[p.platform] ?? p.platform}
                      </p>
                    </div>
                    <p className="text-xl font-mono font-bold text-accent-primary">
                      ${p.cost_usd.toFixed(4)}
                    </p>
                    <p className="text-[10px] text-text-secondary/40 mt-0.5">
                      {p.message_count} message{p.message_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily stacked chart */}
          <div className="bg-bg-tertiary p-5 rounded-[2px] border border-border">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-4">
              {currentRange.label}
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
                    tick={{
                      fontSize: chartData.length > 14 && !useMonthly ? 10 : 11,
                      fill: "rgba(255,255,255,0.3)",
                      angle: chartData.length > 14 && !useMonthly ? -45 : 0,
                      textAnchor:
                        chartData.length > 14 && !useMonthly ? "end" : "middle",
                      dy: chartData.length > 14 && !useMonthly ? 5 : 0,
                    } as React.SVGProps<SVGTextElement>}
                    axisLine={false}
                    tickLine={false}
                    height={chartData.length > 14 && !useMonthly ? 50 : 30}
                    interval={
                      chartData.length <= 14
                        ? 0
                        : chartData.length <= 31
                          ? 1
                          : Math.floor(chartData.length / 12)
                    }
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
                    }}
                    formatter={((value: number | undefined, name: string | undefined) => [
                      `$${(value ?? 0).toFixed(4)}`,
                      PLATFORM_LABELS[name ?? ""] ?? name ?? "",
                    ]) as never}
                    labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                  />
                  {hasAnyPlatform && (
                    <Legend
                      formatter={(value: string) =>
                        PLATFORM_LABELS[value] ?? value
                      }
                      wrapperStyle={{ fontSize: 11 }}
                    />
                  )}
                  {hasClaude && (
                    <Bar
                      dataKey="claude"
                      stackId="platform"
                      fill={PLATFORM_COLOURS.claude}
                      radius={[0, 0, 0, 0]}
                      maxBarSize={36}
                    />
                  )}
                  {hasGemini && (
                    <Bar
                      dataKey="gemini"
                      stackId="platform"
                      fill={PLATFORM_COLOURS.gemini}
                      radius={[0, 0, 0, 0]}
                      maxBarSize={36}
                    />
                  )}
                  {hasOpenAI && (
                    <Bar
                      dataKey="openai"
                      stackId="platform"
                      fill={PLATFORM_COLOURS.openai}
                      radius={[0, 0, 0, 0]}
                      maxBarSize={36}
                    />
                  )}
                  {hasOpenRouter && (
                    <Bar
                      dataKey="openrouter"
                      stackId="platform"
                      fill={PLATFORM_COLOURS.openrouter}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={36}
                    />
                  )}
                  {/* Fallback if no platform data yet — show total */}
                  {!hasAnyPlatform && (
                    <Bar
                      dataKey="cost"
                      fill="#C8FF00"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={36}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Platform cost table */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-3">
              Cost by Platform ({currentRange.label})
            </h3>
            {platformRows.length === 0 ? (
              <p className="text-sm text-text-secondary/40 text-center py-8">
                No cost data yet
              </p>
            ) : (
              <div className="bg-bg-tertiary rounded-[2px] border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                        Platform
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
                    {platformRows.map((row) => (
                      <tr
                        key={row.platform}
                        className="border-b border-border/50 last:border-b-0 hover:bg-bg-secondary/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-text-primary">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: row.colour }}
                            />
                            {row.name}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary/60 text-right font-mono">
                          {row.message_count}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-accent-primary text-right">
                          ${row.cost_usd.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-text-secondary/40 text-right font-mono">
                          {row.message_count > 0
                            ? `$${(row.cost_usd / row.message_count).toFixed(4)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    {platformRows.length > 1 && (
                      <tr className="bg-bg-secondary/30">
                        <td className="px-4 py-3 text-sm font-semibold text-text-primary">
                          Total
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary/60 text-right font-mono font-semibold">
                          {platformRows.reduce((s, r) => s + r.message_count, 0)}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-accent-primary text-right font-semibold">
                          ${platformRows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-text-secondary/40 text-right font-mono">
                          {(() => {
                            const totalMsgs = platformRows.reduce((s, r) => s + r.message_count, 0);
                            const totalCost = platformRows.reduce((s, r) => s + r.cost_usd, 0);
                            return totalMsgs > 0 ? `$${(totalCost / totalMsgs).toFixed(4)}` : "—";
                          })()}
                        </td>
                      </tr>
                    )}
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

function CostCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-[2px] border ${
        highlight
          ? "bg-accent-primary/10 border-accent-primary/30"
          : "bg-bg-tertiary border-border"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
        {label}
      </p>
      <p className="text-2xl font-mono font-bold text-accent-primary mt-1">
        ${value.toFixed(2)}
      </p>
    </div>
  );
}
