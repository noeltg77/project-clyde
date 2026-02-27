"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ScheduleForm,
  defaultFormData,
  buildCronFromForm,
  parseCronToForm,
  type ScheduleFormData,
} from "./ScheduleForm";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

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

/* ── Display helpers ───────────────────────────────────────────── */

function humanCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  // Format time as HH:MM (pad with leading zeros)
  const fmtTime = (h: string, m: string) =>
    `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

  // Every N minutes
  if (min.startsWith("*/") && hour === "*") {
    return `Every ${min.slice(2)} minutes`;
  }
  // Every N hours
  if (min === "0" && hour.startsWith("*/")) {
    return `Every ${hour.slice(2)} hours`;
  }

  // Specific time patterns (hour and min are both literal numbers)
  if (hour !== "*" && !hour.startsWith("*/") && dom === "*" && mon === "*") {
    const time = fmtTime(hour, min);

    if (hour === "0" && min === "0" && dow === "*") {
      return "Daily at midnight";
    }
    if (dow === "MON-FRI") {
      return `Weekdays at ${time}`;
    }
    if (dow === "*") {
      return `Daily at ${time}`;
    }
    // Specific day of week
    return `${dow} at ${time}`;
  }

  // Monthly (specific day of month)
  if (hour !== "*" && !hour.startsWith("*/") && dom !== "*" && mon === "*" && dow === "*") {
    const time = fmtTime(hour, min);
    const daySuffix =
      dom === "1" || dom === "21" || dom === "31" ? "st" :
      dom === "2" || dom === "22" ? "nd" :
      dom === "3" || dom === "23" ? "rd" : "th";
    return `Monthly on the ${dom}${daySuffix} at ${time}`;
  }

  return cron;
}

function formatScheduleBadge(s: Schedule): string {
  const type = s.schedule_type ?? "recurring";

  if (type === "one_off") {
    if (!s.run_at) return "One-off";
    const dt = new Date(s.run_at);
    return `Once: ${dt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })} at ${dt.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return s.cron ? humanCron(s.cron) : "No schedule";
}

/** True if a one-off schedule has already fired */
function isOneOffCompleted(s: Schedule): boolean {
  return (s.schedule_type ?? "recurring") === "one_off" && !s.enabled && s.run_count > 0;
}

/* ── Component ─────────────────────────────────────────────────── */

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ScheduleFormData>({
    ...defaultFormData,
  });

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/schedules`);
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch (err) {
      console.error("Failed to fetch schedules:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/schedules/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggle_enabled: true }),
        });
        await fetchSchedules();
      } catch (err) {
        console.error("Failed to toggle schedule:", err);
      }
    },
    [fetchSchedules]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/schedules/${id}`, { method: "DELETE" });
        await fetchSchedules();
      } catch (err) {
        console.error("Failed to delete schedule:", err);
      }
    },
    [fetchSchedules]
  );

  /* ── Create handler ────────────────────────────────────────── */

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.name || !formData.prompt) return;

      let payload: Record<string, unknown>;

      if (formData.mode === "one_off") {
        if (!formData.run_date || !formData.run_time) return;
        // Combine date + time as local, then convert to UTC ISO
        const localIso = `${formData.run_date}T${formData.run_time}:00`;
        const utcIso = new Date(localIso).toISOString();
        payload = {
          name: formData.name,
          prompt: formData.prompt,
          agent_name: formData.agent_name || null,
          schedule_type: "one_off",
          run_at: utcIso,
        };
      } else {
        const cron = buildCronFromForm(formData);
        payload = {
          name: formData.name,
          prompt: formData.prompt,
          agent_name: formData.agent_name || null,
          schedule_type: "recurring",
          cron,
        };
      }

      try {
        await fetch(`${API_URL}/api/schedules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setFormData({ ...defaultFormData });
        setShowForm(false);
        await fetchSchedules();
      } catch (err) {
        console.error("Failed to create schedule:", err);
      }
    },
    [formData, fetchSchedules]
  );

  /* ── Edit handler — populate form from existing schedule ───── */

  const handleEdit = useCallback(
    (s: Schedule) => {
      const isOneOff = (s.schedule_type ?? "recurring") === "one_off";

      // Build form data from schedule
      const cronFields = s.cron
        ? parseCronToForm(s.cron)
        : { frequency: "daily" as const, time_hour: "09", time_minute: "00", hourly_interval: "1", day_of_week: "MON", day_of_month: "1" };
      const runDate = s.run_at ? new Date(s.run_at) : null;

      setFormData({
        name: s.name,
        prompt: s.prompt,
        agent_name: s.agent_name || "",
        mode: isOneOff ? "one_off" : "recurring",
        // Recurring fields
        frequency: cronFields.frequency,
        time_hour: cronFields.time_hour,
        time_minute: cronFields.time_minute,
        hourly_interval: cronFields.hourly_interval,
        day_of_week: cronFields.day_of_week,
        day_of_month: cronFields.day_of_month,
        // One-off fields
        run_date: runDate
          ? runDate.toISOString().split("T")[0]
          : "",
        run_time: runDate
          ? runDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
          : "09:00",
      });
      setEditingId(s.id);
      setShowForm(true);
    },
    []
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setFormData({ ...defaultFormData });
    setShowForm(false);
  }, []);

  /* ── Update handler — PATCH existing schedule ──────────────── */

  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingId || !formData.name || !formData.prompt) return;

      let payload: Record<string, unknown>;

      if (formData.mode === "one_off") {
        if (!formData.run_date || !formData.run_time) return;
        const localIso = `${formData.run_date}T${formData.run_time}:00`;
        const utcIso = new Date(localIso).toISOString();
        payload = {
          name: formData.name,
          prompt: formData.prompt,
          agent_name: formData.agent_name || null,
          schedule_type: "one_off",
          run_at: utcIso,
        };
      } else {
        const cron = buildCronFromForm(formData);
        payload = {
          name: formData.name,
          prompt: formData.prompt,
          agent_name: formData.agent_name || null,
          schedule_type: "recurring",
          cron,
        };
      }

      try {
        await fetch(`${API_URL}/api/schedules/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setEditingId(null);
        setFormData({ ...defaultFormData });
        setShowForm(false);
        await fetchSchedules();
      } catch (err) {
        console.error("Failed to update schedule:", err);
      }
    },
    [editingId, formData, fetchSchedules]
  );

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary font-display">
            Schedules
          </h2>
          <button
            onClick={() => {
              if (showForm) {
                // Cancel — reset form + editing state
                setShowForm(false);
                setEditingId(null);
                setFormData({ ...defaultFormData });
              } else {
                setShowForm(true);
              }
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-[2px] transition-colors ${
              showForm
                ? "text-text-secondary hover:text-text-primary"
                : "border border-accent-primary text-accent-primary hover:bg-accent-primary/10"
            }`}
          >
            {showForm ? "Cancel" : "+ New Schedule"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* New schedule form */}
          {showForm && (
            <ScheduleForm
              formData={formData}
              setFormData={setFormData}
              onSubmit={editingId ? handleUpdate : handleCreate}
              editingId={editingId}
              onCancelEdit={handleCancelEdit}
            />
          )}

          {/* Loading state */}
          {loading && (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-bg-tertiary animate-pulse rounded-[2px]"
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && schedules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-text-secondary/50">
                No schedules yet
              </p>
              <p className="text-[11px] text-text-secondary/30 mt-1">
                Create one above or ask Clyde to schedule a task
              </p>
            </div>
          )}

          {/* Schedule list */}
          {schedules.map((s) => (
            <div
              key={s.id}
              className="group p-4 rounded-[2px] bg-bg-tertiary border border-border hover:border-accent-primary/20 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-sm font-medium text-text-primary">
                      {s.name}
                    </p>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-[2px] ${
                        (s.schedule_type ?? "recurring") === "one_off"
                          ? "text-accent-secondary/70 bg-accent-secondary/10"
                          : "text-text-secondary/60 bg-bg-secondary"
                      }`}
                    >
                      {formatScheduleBadge(s)}
                    </span>
                  </div>
                  {/* Prompt */}
                  <p className="text-[12px] text-text-secondary/50 mt-1">
                    {s.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {/* Toggle / Completed badge */}
                  {isOneOffCompleted(s) ? (
                    <span className="text-[10px] text-text-secondary/40 px-1.5 py-0.5 border border-border rounded-[2px]">
                      Completed
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggle(s.id)}
                      className={`w-9 h-5 rounded-full relative transition-colors ${
                        s.enabled
                          ? "bg-accent-primary/30"
                          : "bg-text-secondary/20"
                      }`}
                      title={s.enabled ? "Pause" : "Resume"}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                          s.enabled
                            ? "bg-accent-primary"
                            : "bg-text-secondary/50"
                        }`}
                        style={{ left: s.enabled ? "18px" : "3px" }}
                      />
                    </button>
                  )}
                  {/* Edit button */}
                  <button
                    onClick={() => handleEdit(s)}
                    className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-accent-primary hover:bg-accent-primary/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="Edit"
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
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
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
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2">
                {s.agent_name && (
                  <span className="text-[11px] text-accent-primary/70 font-medium">
                    {s.agent_name}
                  </span>
                )}
                <span className="text-[11px] text-text-secondary/40">
                  {s.run_count} run{s.run_count !== 1 ? "s" : ""}
                </span>
                {s.last_run && (
                  <span className="text-[11px] text-text-secondary/30">
                    Last: {new Date(s.last_run).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
