"use client";

import type { Dispatch, SetStateAction, FormEvent } from "react";

/* ── Types ─────────────────────────────────────────────────────── */

export type ScheduleMode = "recurring" | "one_off";
export type RecurringFrequency = "hourly" | "daily" | "weekly" | "monthly";

export type ScheduleFormData = {
  name: string;
  prompt: string;
  agent_name: string;
  // Mode
  mode: ScheduleMode;
  // Recurring
  frequency: RecurringFrequency;
  time_hour: string;
  time_minute: string;
  hourly_interval: string;
  day_of_week: string;
  day_of_month: string;
  // One-off
  run_date: string;
  run_time: string;
};

export const defaultFormData: ScheduleFormData = {
  name: "",
  prompt: "",
  agent_name: "",
  mode: "recurring",
  frequency: "daily",
  time_hour: "09",
  time_minute: "00",
  hourly_interval: "1",
  day_of_week: "MON",
  day_of_month: "1",
  run_date: "",
  run_time: "09:00",
};

/* ── Cron builder ──────────────────────────────────────────────── */

export function buildCronFromForm(fd: ScheduleFormData): string {
  const h = parseInt(fd.time_hour, 10);
  const m = parseInt(fd.time_minute, 10);

  switch (fd.frequency) {
    case "hourly":
      return `0 */${fd.hourly_interval} * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${fd.day_of_week}`;
    case "monthly":
      return `${m} ${h} ${fd.day_of_month} * *`;
    default:
      return "0 9 * * *";
  }
}

/* ── Shared classes ────────────────────────────────────────────── */

const LABEL =
  "block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5";
const INPUT =
  "w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary";
const SELECT =
  "w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary focus:outline-none focus:border-accent-primary appearance-none cursor-pointer [color-scheme:dark]";
const DATE_INPUT = `${INPUT} [color-scheme:dark]`;

/* ── Helpers ───────────────────────────────────────────────────── */

const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
const MINUTES = ["00", "15", "30", "45"];
const DAYS_OF_WEEK = [
  { value: "MON-FRI", label: "Weekdays (Mon–Fri)" },
  { value: "MON", label: "Monday" },
  { value: "TUE", label: "Tuesday" },
  { value: "WED", label: "Wednesday" },
  { value: "THU", label: "Thursday" },
  { value: "FRI", label: "Friday" },
  { value: "SAT", label: "Saturday" },
  { value: "SUN", label: "Sunday" },
];
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => String(i + 1));

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/* ── Select wrapper with chevron ───────────────────────────────── */

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary/40"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M2 3.5L5 6.5L8 3.5" />
      </svg>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

/* ── Cron → form data parser (best-effort reverse of buildCronFromForm) ── */

export function parseCronToForm(
  cron: string
): Pick<ScheduleFormData, "frequency" | "time_hour" | "time_minute" | "hourly_interval" | "day_of_week" | "day_of_month"> {
  const parts = cron.split(" ");
  if (parts.length !== 5) {
    return { frequency: "daily", time_hour: "09", time_minute: "00", hourly_interval: "1", day_of_week: "MON", day_of_month: "1" };
  }
  const [min, hour, dom, , dow] = parts;

  // Hourly: 0 */N * * *
  if (hour.startsWith("*/")) {
    return {
      frequency: "hourly",
      time_hour: "09",
      time_minute: "00",
      hourly_interval: hour.slice(2),
      day_of_week: "MON",
      day_of_month: "1",
    };
  }

  // Monthly: M H D * *
  if (dom !== "*") {
    return {
      frequency: "monthly",
      time_hour: String(parseInt(hour, 10)).padStart(2, "0"),
      time_minute: String(parseInt(min, 10)).padStart(2, "0"),
      hourly_interval: "1",
      day_of_week: "MON",
      day_of_month: dom,
    };
  }

  // Weekly: M H * * DOW (where DOW !== *)
  if (dow !== "*") {
    return {
      frequency: "weekly",
      time_hour: String(parseInt(hour, 10)).padStart(2, "0"),
      time_minute: String(parseInt(min, 10)).padStart(2, "0"),
      hourly_interval: "1",
      day_of_week: dow,
      day_of_month: "1",
    };
  }

  // Daily (default): M H * * *
  return {
    frequency: "daily",
    time_hour: String(parseInt(hour, 10)).padStart(2, "0"),
    time_minute: String(parseInt(min, 10)).padStart(2, "0"),
    hourly_interval: "1",
    day_of_week: "MON",
    day_of_month: "1",
  };
}

type Props = {
  formData: ScheduleFormData;
  setFormData: Dispatch<SetStateAction<ScheduleFormData>>;
  onSubmit: (e: FormEvent) => void;
  /** When set, the form is in edit mode */
  editingId?: string | null;
  onCancelEdit?: () => void;
};

export function ScheduleForm({ formData, setFormData, onSubmit, editingId, onCancelEdit }: Props) {
  const set = <K extends keyof ScheduleFormData>(
    key: K,
    val: ScheduleFormData[K]
  ) => setFormData((f) => ({ ...f, [key]: val }));

  const isRecurring = formData.mode === "recurring";

  return (
    <form
      onSubmit={onSubmit}
      className="p-5 bg-bg-tertiary rounded-[2px] border border-border space-y-4"
    >
      {/* ── Mode toggle ───────────────────────────────────── */}
      <div className="flex gap-0">
        {(["recurring", "one_off"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set("mode", m)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
              formData.mode === m
                ? "border-accent-primary text-accent-primary bg-accent-primary/10 z-10"
                : "border-border text-text-secondary/40 hover:text-text-secondary/60"
            } ${m === "recurring" ? "rounded-l-[2px]" : "rounded-r-[2px] -ml-px"}`}
          >
            {m === "recurring" ? "Recurring" : "One-off"}
          </button>
        ))}
      </div>

      {/* ── Row 1: Name + (Frequency | Date) ──────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className={LABEL}>Schedule Name</label>
          <input
            type="text"
            placeholder="e.g. Morning Report"
            value={formData.name}
            onChange={(e) => set("name", e.target.value)}
            className={INPUT}
          />
        </div>

        {isRecurring ? (
          /* Frequency select */
          <div>
            <label className={LABEL}>Frequency</label>
            <SelectWrap>
              <select
                value={formData.frequency}
                onChange={(e) =>
                  set("frequency", e.target.value as RecurringFrequency)
                }
                className={SELECT}
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </SelectWrap>
          </div>
        ) : (
          /* One-off: Date */
          <div>
            <label className={LABEL}>Run Date</label>
            <input
              type="date"
              min={todayStr()}
              value={formData.run_date}
              onChange={(e) => set("run_date", e.target.value)}
              className={DATE_INPUT}
            />
          </div>
        )}
      </div>

      {/* ── Row 2: Schedule-specific fields ────────────────── */}
      {isRecurring ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Conditional first column */}
          {formData.frequency === "hourly" && (
            <div>
              <label className={LABEL}>Every N Hours</label>
              <SelectWrap>
                <select
                  value={formData.hourly_interval}
                  onChange={(e) => set("hourly_interval", e.target.value)}
                  className={SELECT}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      {n} {n === 1 ? "hour" : "hours"}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          )}

          {formData.frequency === "weekly" && (
            <div>
              <label className={LABEL}>Day</label>
              <SelectWrap>
                <select
                  value={formData.day_of_week}
                  onChange={(e) => set("day_of_week", e.target.value)}
                  className={SELECT}
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          )}

          {formData.frequency === "monthly" && (
            <div>
              <label className={LABEL}>Day of Month</label>
              <SelectWrap>
                <select
                  value={formData.day_of_month}
                  onChange={(e) => set("day_of_month", e.target.value)}
                  className={SELECT}
                >
                  {DAYS_OF_MONTH.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          )}

          {/* Hour + Minute (hidden for hourly) */}
          {formData.frequency !== "hourly" && (
            <>
              <div>
                <label className={LABEL}>Hour</label>
                <SelectWrap>
                  <select
                    value={formData.time_hour}
                    onChange={(e) => set("time_hour", e.target.value)}
                    className={SELECT}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                </SelectWrap>
              </div>
              <div>
                <label className={LABEL}>Minute</label>
                <SelectWrap>
                  <select
                    value={formData.time_minute}
                    onChange={(e) => set("time_minute", e.target.value)}
                    className={SELECT}
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        :{m}
                      </option>
                    ))}
                  </select>
                </SelectWrap>
              </div>
            </>
          )}
        </div>
      ) : (
        /* One-off: Time */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Run Time</label>
            <input
              type="time"
              value={formData.run_time}
              onChange={(e) => set("run_time", e.target.value)}
              className={DATE_INPUT}
            />
          </div>
        </div>
      )}

      {/* ── Prompt ─────────────────────────────────────────── */}
      <div>
        <label className={LABEL}>Prompt</label>
        <textarea
          placeholder="What should be executed on this schedule?"
          value={formData.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          rows={3}
          className={`${INPUT} resize-none`}
        />
      </div>

      {/* ── Agent + Submit ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <div>
          <label className={LABEL}>Agent (optional)</label>
          <input
            type="text"
            placeholder="Leave blank for Clyde"
            value={formData.agent_name}
            onChange={(e) => set("agent_name", e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex gap-2">
          {editingId && onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="flex-1 py-2 text-sm font-medium rounded-[2px] border border-border text-text-secondary/60 hover:text-text-secondary hover:bg-bg-secondary transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="flex-1 py-2 text-sm font-medium rounded-[2px] border border-accent-primary text-accent-primary hover:bg-accent-primary/10 transition-colors"
          >
            {editingId ? "Update Schedule" : "Create Schedule"}
          </button>
        </div>
      </div>
    </form>
  );
}
