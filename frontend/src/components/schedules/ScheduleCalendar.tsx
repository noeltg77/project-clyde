"use client";

import { useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";

/* ── Types ─────────────────────────────────────────────────────── */

export type Schedule = {
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

type DayEntry = {
  schedule: Schedule;
  time: string; // "HH:MM" or "All day"
};

/* ── Cron → days-of-month helper ──────────────────────────────── */

const DOW_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function parseDow(field: string): number[] | null {
  if (field === "*") return null; // every day
  // Range like MON-FRI
  if (field.includes("-")) {
    const [start, end] = field.split("-");
    const s = DOW_MAP[start] ?? parseInt(start);
    const e = DOW_MAP[end] ?? parseInt(end);
    const days: number[] = [];
    for (let d = s; d <= e; d++) days.push(d);
    return days;
  }
  // Comma-separated
  return field.split(",").map((d) => DOW_MAP[d] ?? parseInt(d));
}

function getScheduleDaysInMonth(
  s: Schedule,
  year: number,
  month: number // 0-indexed
): DayEntry[] {
  const entries: DayEntry[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if ((s.schedule_type ?? "recurring") === "one_off") {
    if (!s.run_at) return entries;
    const dt = new Date(s.run_at);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      entries.push({
        schedule: s,
        time: dt.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }
    return entries;
  }

  // Recurring — parse cron
  if (!s.cron) return entries;
  const parts = s.cron.split(" ");
  if (parts.length !== 5) return entries;
  const [minF, hourF, domF, monF, dowF] = parts;

  // Check month filter
  if (monF !== "*") {
    const months = monF.split(",").map((m) => parseInt(m));
    if (!months.includes(month + 1)) return entries;
  }

  // Determine time display
  let timeStr = "All day";
  if (hourF !== "*" && !hourF.startsWith("*/")) {
    const h = hourF.padStart(2, "0");
    const m = minF === "*" || minF.startsWith("*/") ? "00" : minF.padStart(2, "0");
    timeStr = `${h}:${m}`;
  } else if (hourF.startsWith("*/")) {
    timeStr = `Every ${hourF.slice(2)}h`;
  } else if (minF.startsWith("*/")) {
    timeStr = `Every ${minF.slice(2)}m`;
  }

  const allowedDow = parseDow(dowF);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay(); // 0=Sun

    // Check day-of-week filter
    if (allowedDow && !allowedDow.includes(dayOfWeek)) continue;

    // Check day-of-month filter
    if (domF !== "*") {
      const doms = domF.split(",").map((d) => parseInt(d));
      if (!doms.includes(day)) continue;
    }

    entries.push({ schedule: s, time: timeStr });
  }

  return entries;
}

/* ── Calendar grid helpers ────────────────────────────────────── */

function getDaysGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  // Monday = 0, Sunday = 6
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = [];

  // Leading days from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, isCurrentMonth: true });
  }

  // Trailing days to fill the last week
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, month: nm, year: ny, isCurrentMonth: false });
    }
  }

  return cells;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ── Component ─────────────────────────────────────────────────── */

type ScheduleCalendarProps = {
  schedules: Schedule[];
  onEditSchedule?: (schedule: Schedule) => void;
};

export function ScheduleCalendar({ schedules, onEditSchedule }: ScheduleCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const cells = useMemo(() => getDaysGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  // Pre-compute schedule entries per day-of-month for current view
  const dayScheduleMap = useMemo(() => {
    const map = new Map<number, DayEntry[]>();
    for (const s of schedules) {
      const entries = getScheduleDaysInMonth(s, viewYear, viewMonth);
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      if ((s.schedule_type ?? "recurring") === "one_off") {
        // One-off: entries has 0 or 1 element
        if (entries.length === 1 && s.run_at) {
          const dt = new Date(s.run_at);
          const day = dt.getDate();
          if (!map.has(day)) map.set(day, []);
          map.get(day)!.push(entries[0]);
        }
      } else {
        // Recurring: entries are in day order, one per matching day
        if (!s.cron) continue;
        const parts = s.cron.split(" ");
        if (parts.length !== 5) continue;
        const [, , domF, monF, dowF] = parts;
        if (monF !== "*") {
          const months = monF.split(",").map((m) => parseInt(m));
          if (!months.includes(viewMonth + 1)) continue;
        }
        const allowedDow = parseDow(dowF);
        let entryIdx = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(viewYear, viewMonth, day);
          const dayOfWeek = date.getDay();
          if (allowedDow && !allowedDow.includes(dayOfWeek)) continue;
          if (domF !== "*") {
            const doms = domF.split(",").map((d) => parseInt(d));
            if (!doms.includes(day)) continue;
          }
          if (entryIdx < entries.length) {
            if (!map.has(day)) map.set(day, []);
            map.get(day)!.push(entries[entryIdx]);
            entryIdx++;
          }
        }
      }
    }
    return map;
  }, [schedules, viewYear, viewMonth]);

  const prevMonth = useCallback(() => {
    setSelectedDay(null);
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    setSelectedDay(null);
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  const goToToday = useCallback(() => {
    setSelectedDay(null);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }, [today]);

  const isToday = (day: number, month: number, year: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // Determine which week row the selected day is in
  const selectedWeekRowEnd = useMemo(() => {
    if (selectedDay === null) return -1;
    const idx = cells.findIndex(
      (c) => c.day === selectedDay && c.month === viewMonth && c.year === viewYear
    );
    if (idx === -1) return -1;
    return Math.floor(idx / 7) + 1; // 1-indexed row
  }, [selectedDay, cells, viewMonth, viewYear]);

  const selectedDayEntries = selectedDay ? dayScheduleMap.get(selectedDay) || [] : [];

  // Split cells into week rows for panel insertion
  const weekRows: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weekRows.push(cells.slice(i, i + 7));
  }

  return (
    <div className="rounded-[2px] bg-bg-primary border border-border overflow-hidden">
      {/* Month header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-text-primary font-display tracking-wide">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h3>
          {(viewMonth !== today.getMonth() || viewYear !== today.getFullYear()) && (
            <button
              onClick={goToToday}
              className="text-[10px] text-accent-primary/70 hover:text-accent-primary px-1.5 py-0.5 rounded-[2px] border border-accent-primary/20 hover:border-accent-primary/40 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-border bg-bg-secondary/30">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — row by row with expandable panels */}
      <div>
        {weekRows.map((row, rowIdx) => (
          <div key={rowIdx}>
            <div className="grid grid-cols-7">
              {row.map((cell, colIdx) => {
                const entries = cell.isCurrentMonth
                  ? dayScheduleMap.get(cell.day) || []
                  : [];
                const hasSchedules = entries.length > 0;
                const isTodayCell = isToday(cell.day, cell.month, cell.year);
                const isSelected =
                  selectedDay === cell.day && cell.isCurrentMonth;

                return (
                  <button
                    key={`${rowIdx}-${colIdx}`}
                    onClick={() => {
                      if (!cell.isCurrentMonth || !hasSchedules) {
                        setSelectedDay(null);
                        return;
                      }
                      setSelectedDay(
                        selectedDay === cell.day ? null : cell.day
                      );
                    }}
                    className={`relative min-h-[96px] p-2.5 border-b border-r border-border/50 text-left transition-colors ${
                      cell.isCurrentMonth
                        ? hasSchedules
                          ? "hover:bg-bg-tertiary/60 cursor-pointer"
                          : "cursor-default"
                        : "bg-bg-primary/50 cursor-default"
                    } ${isSelected ? "bg-bg-tertiary/80" : ""}`}
                  >
                    {/* Day number */}
                    <span
                      className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                        isTodayCell
                          ? "bg-accent-primary text-bg-primary font-bold"
                          : cell.isCurrentMonth
                          ? "text-text-primary"
                          : "text-text-secondary/15"
                      }`}
                    >
                      {cell.day}
                    </span>

                    {/* Schedule dots */}
                    {cell.isCurrentMonth && entries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {entries.slice(0, 5).map((entry, i) => (
                          <div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full ${
                              !entry.schedule.enabled
                                ? "bg-text-secondary/20"
                                : (entry.schedule.schedule_type ?? "recurring") === "one_off"
                                ? "bg-accent-secondary"
                                : "bg-accent-primary"
                            }`}
                            title={`${entry.schedule.name} — ${entry.time}`}
                          />
                        ))}
                        {entries.length > 5 && (
                          <span className="text-[8px] text-text-secondary/40 leading-none ml-0.5">
                            +{entries.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Expandable detail panel — inserted after the week row containing the selected day */}
            <AnimatePresence>
              {selectedWeekRowEnd === rowIdx + 1 && selectedDayEntries.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="bg-bg-secondary/50 border-b border-border border-l-2 border-l-accent-primary px-5 py-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50 mb-3">
                      {selectedDay}{" "}
                      {MONTH_NAMES[viewMonth].slice(0, 3)} — {selectedDayEntries.length} schedule
                      {selectedDayEntries.length !== 1 ? "s" : ""}
                    </p>
                    <div className="space-y-2">
                      {selectedDayEntries.map((entry, i) => (
                        <button
                          key={i}
                          onClick={() => onEditSchedule?.(entry.schedule)}
                          className={`w-full flex items-center gap-3 py-2 px-3 rounded-[2px] text-left transition-colors group/entry ${
                            entry.schedule.enabled
                              ? "bg-bg-tertiary hover:bg-bg-tertiary/80 hover:border-accent-primary/30"
                              : "bg-bg-tertiary/50 opacity-50 hover:opacity-70"
                          } border border-transparent hover:border-accent-primary/20`}
                        >
                          {/* Type indicator dot */}
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              !entry.schedule.enabled
                                ? "bg-text-secondary/30"
                                : (entry.schedule.schedule_type ?? "recurring") === "one_off"
                                ? "bg-accent-secondary"
                                : "bg-accent-primary"
                            }`}
                          />
                          {/* Name */}
                          <span className="text-xs text-text-primary font-medium truncate flex-1 group-hover/entry:text-accent-primary transition-colors">
                            {entry.schedule.name}
                          </span>
                          {/* Time */}
                          <span className="text-[10px] font-mono text-text-secondary/60 shrink-0">
                            {entry.time}
                          </span>
                          {/* Badge */}
                          <span
                            className={`text-[9px] font-mono px-1 py-0.5 rounded-[2px] shrink-0 ${
                              (entry.schedule.schedule_type ?? "recurring") === "one_off"
                                ? "text-accent-secondary/70 bg-accent-secondary/10"
                                : "text-text-secondary/50 bg-bg-secondary"
                            }`}
                          >
                            {(entry.schedule.schedule_type ?? "recurring") === "one_off"
                              ? "once"
                              : "recurring"}
                          </span>
                          {/* Status */}
                          {!entry.schedule.enabled && (
                            <span className="text-[9px] text-text-secondary/40">
                              paused
                            </span>
                          )}
                          {/* Edit hint */}
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="shrink-0 text-text-secondary/20 group-hover/entry:text-accent-primary/60 transition-colors"
                          >
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
