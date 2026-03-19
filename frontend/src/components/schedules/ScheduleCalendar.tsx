"use client";

import { useState, useMemo } from "react";

/* ── Types ─────────────────────────────────────────────────────── */

type Schedule = {
  id: string;
  name: string;
  schedule_type: "recurring" | "one_off";
  cron: string | null;
  run_at: string | null;
  prompt: string;
  agent_name: string | null;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  run_count: number;
};

type Props = {
  schedules: Schedule[];
  onEdit: (schedule: Schedule) => void;
};

/* ── Cron → matching days resolver ─────────────────────────────── */

/** Map 3-letter day abbr to JS getDay() value (0=Sun, 1=Mon, ...) */
const DOW_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

type ScheduleOccurrence = {
  schedule: Schedule;
  time: string; // HH:MM
};

/**
 * Given a cron string and a year/month, return the day-of-month numbers
 * where the schedule fires, plus the time string.
 */
function cronToDays(
  cron: string,
  year: number,
  month: number // 0-indexed
): { days: number[]; time: string } {
  const parts = cron.split(" ");
  if (parts.length !== 5) return { days: [], time: "" };
  const [min, hour, dom, , dow] = parts;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Format time
  const fmtH = hour === "*" || hour.startsWith("*/") ? "" : hour.padStart(2, "0");
  const fmtM = min === "*" || min.startsWith("*/") ? "00" : min.padStart(2, "0");
  const time = fmtH ? `${fmtH}:${fmtM}` : "";

  // Every N minutes or every N hours → fires every day
  if (hour === "*" || hour.startsWith("*/")) {
    return { days: allDays, time: time || "all day" };
  }

  // Monthly: specific DOM
  if (dom !== "*") {
    const d = parseInt(dom, 10);
    if (d >= 1 && d <= daysInMonth) return { days: [d], time };
    return { days: [], time };
  }

  // Weekly: specific DOW
  if (dow !== "*") {
    // Handle "MON-FRI" range
    let targetDows: number[];
    if (dow === "MON-FRI") {
      targetDows = [1, 2, 3, 4, 5];
    } else if (dow.includes(",")) {
      targetDows = dow.split(",").map((d) => DOW_MAP[d] ?? -1).filter((d) => d >= 0);
    } else {
      const mapped = DOW_MAP[dow];
      targetDows = mapped !== undefined ? [mapped] : [];
    }

    const matchingDays = allDays.filter((day) => {
      const jsDay = new Date(year, month, day).getDay();
      return targetDows.includes(jsDay);
    });
    return { days: matchingDays, time };
  }

  // Daily: fires every day at specific time
  return { days: allDays, time };
}

/* ── Calendar grid helpers ─────────────────────────────────────── */

function getCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Monday = 0, Sunday = 6 (ISO week)
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const cells: { day: number; currentMonth: boolean }[] = [];

  // Previous month overflow
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, currentMonth: false });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, currentMonth: true });
  }

  // Next month overflow to fill 6 rows (42 cells)
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, currentMonth: false });
  }

  return cells;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ── Component ─────────────────────────────────────────────────── */

export function ScheduleCalendar({ schedules, onEdit }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const cells = useMemo(() => getCalendarGrid(year, month), [year, month]);

  // Build a map: day number → occurrences for current month
  const dayMap = useMemo(() => {
    const map = new Map<number, ScheduleOccurrence[]>();

    for (const s of schedules) {
      const type = s.schedule_type ?? "recurring";

      if (type === "one_off" && s.run_at) {
        const dt = new Date(s.run_at);
        if (dt.getFullYear() === year && dt.getMonth() === month) {
          const day = dt.getDate();
          const time = dt.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const list = map.get(day) || [];
          list.push({ schedule: s, time });
          map.set(day, list);
        }
      } else if (type === "recurring" && s.cron) {
        const { days, time } = cronToDays(s.cron, year, month);
        for (const day of days) {
          const list = map.get(day) || [];
          list.push({ schedule: s, time });
          map.set(day, list);
        }
      }
    }

    return map;
  }, [schedules, year, month]);

  const goToPrevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  /** True if a one-off schedule has already fired */
  const isOneOffCompleted = (s: Schedule) =>
    (s.schedule_type ?? "recurring") === "one_off" && !s.enabled && s.run_count > 0;

  /** Get styling classes for a schedule block */
  const getBlockClasses = (s: Schedule) => {
    if (isOneOffCompleted(s)) {
      return "bg-text-secondary/10 text-text-secondary/30 line-through";
    }
    if (!s.enabled) {
      return "bg-text-secondary/10 text-text-secondary/40";
    }
    if ((s.schedule_type ?? "recurring") === "one_off") {
      return "bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/30";
    }
    return "bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25";
  };

  return (
    <div className="space-y-4">
      {/* Navigation header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-text-primary font-display">
            {MONTH_NAMES[month]} {year}
          </h3>
          {!isCurrentMonth && (
            <button
              onClick={goToToday}
              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 border border-border rounded-[2px] hover:text-text-primary hover:border-text-secondary/40 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary/50 hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={goToNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary/50 hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-border rounded-[2px] overflow-hidden">
        {/* Day name headers */}
        <div className="grid grid-cols-7 bg-bg-secondary">
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 text-center border-b border-border"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells — 6 rows */}
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            const isToday =
              cell.currentMonth &&
              cell.day === today.getDate() &&
              isCurrentMonth;
            const occurrences = cell.currentMonth
              ? dayMap.get(cell.day) || []
              : [];

            return (
              <div
                key={idx}
                className={`min-h-[100px] border-b border-r border-border p-1.5 ${
                  cell.currentMonth ? "bg-bg-primary" : "bg-bg-secondary/50"
                } ${idx % 7 === 0 ? "" : ""}`}
              >
                {/* Day number */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-[11px] font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-accent-primary text-bg-primary font-bold"
                        : cell.currentMonth
                        ? "text-text-primary/70"
                        : "text-text-secondary/20"
                    }`}
                  >
                    {cell.day}
                  </span>
                </div>

                {/* Schedule blocks */}
                <div className="space-y-0.5 overflow-y-auto max-h-[72px]">
                  {occurrences.map((occ) => (
                    <button
                      key={occ.schedule.id}
                      onClick={() => onEdit(occ.schedule)}
                      className={`w-full text-left px-1.5 py-0.5 rounded-[2px] text-[10px] leading-tight truncate block transition-colors cursor-pointer ${getBlockClasses(
                        occ.schedule
                      )}`}
                      title={`${occ.schedule.name}${occ.time ? ` at ${occ.time}` : ""} — Click to edit`}
                    >
                      {occ.time && (
                        <span className="opacity-60 mr-1">{occ.time}</span>
                      )}
                      {occ.schedule.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-text-secondary/40">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[1px] bg-accent-primary/30" />
          Recurring
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[1px] bg-accent-secondary/30" />
          One-off
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[1px] bg-text-secondary/15" />
          Disabled / Completed
        </div>
      </div>
    </div>
  );
}
