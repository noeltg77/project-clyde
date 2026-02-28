"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { springs } from "@/lib/design-tokens";
import { PromptEditor } from "./PromptEditor";
import { PromptHistoryViewer } from "./PromptHistoryViewer";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Tab = "system" | "prompts" | "controls";

type RegistrySettings = {
  self_edit_enabled: boolean;
  concurrency_cap: number;
  max_team_size: number;
  cost_alert_threshold_usd: number;
  proactive_mode_enabled: boolean;
  proactive_interval_hours: number;
  save_uploads_enabled: boolean;
  prompt_caching_enabled: boolean;
  prevent_sleep_enabled: boolean;
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <div
      className={`w-2 h-2 rounded-full ${
        ok ? "bg-accent-tertiary" : "bg-error"
      }`}
    />
  );
}

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const [activeTab, setActiveTab] = useState<Tab>("system");

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setSettingsOpen(false)}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={springs.snappy}
            className="fixed top-0 right-0 bottom-0 w-[440px] bg-bg-secondary border-l-2 border-border z-50 flex flex-col shadow-[-8px_0_0_0_rgba(200,255,0,0.1)]"
          >
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-6 border-b-2 border-border">
              <h2 className="font-display text-lg font-bold text-text-primary">
                SETTINGS
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
              >
                <span className="text-xl">&times;</span>
              </button>
            </div>

            {/* Tab Bar */}
            <div className="flex border-b-2 border-border">
              {(["system", "prompts", "controls"] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                    activeTab === tab
                      ? "text-accent-primary border-b-2 border-accent-primary -mb-[2px]"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "system" && <SystemTab />}
              {activeTab === "prompts" && <PromptsTab />}
              {activeTab === "controls" && <ControlsTab />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// System Tab
// =============================================================================

// Env var groups for the API Keys section
const ENV_VAR_GROUPS = [
  {
    service: "Anthropic",
    vars: [{ key: "ANTHROPIC_API_KEY", label: "API Key" }],
  },
  {
    service: "OpenAI",
    vars: [{ key: "OPENAI_API_KEY", label: "API Key" }],
  },
  {
    service: "Supabase",
    vars: [
      { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Project URL" },
      { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Anon Key" },
      { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Service Role Key" },
    ],
  },
] as const;

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function SystemTab() {
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [editedVars, setEditedVars] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState(false);

  useEffect(() => {
    // Load env vars from backend
    fetch(`${API_URL}/api/env-vars`)
      .then((r) => r.json())
      .then((data) => {
        if (data.vars) {
          setEnvVars(data.vars);
          setEditedVars(data.vars);
        }
      })
      .catch(() => {});

    // Load backend health
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setBackendOk(d.backend?.status === "ok"))
      .catch(() => setBackendOk(false));
  }, []);

  const hasChanges = Object.keys(editedVars).some(
    (k) => editedVars[k] !== envVars[k]
  );

  function toggleVisibility(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleChange(key: string, value: string) {
    setEditedVars((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    // Only send changed vars
    const changes: Record<string, string> = {};
    for (const key of Object.keys(editedVars)) {
      if (editedVars[key] !== envVars[key]) {
        changes[key] = editedVars[key];
      }
    }
    if (Object.keys(changes).length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`${API_URL}/api/env-vars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await res.json();
      if (data.success) {
        setEnvVars({ ...envVars, ...changes });
        setSaveResult("Saved. Restart services to apply changes.");
      } else {
        setSaveResult(`Error: ${data.error || "Failed to save"}`);
      }
    } catch {
      setSaveResult("Error: Could not reach backend");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 5000);
    }
  }

  async function handleExport() {
    try {
      const res = await fetch(`${API_URL}/api/system/export`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      a.download = `clyde-export-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed");
    }
  }

  async function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch(`${API_URL}/api/system/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) {
          alert("Import successful. Restart the backend to apply changes.");
        } else {
          alert(`Import failed: ${result.error || "Unknown error"}`);
        }
      } catch {
        alert("Failed to parse import file");
      }
    };
    input.click();
  }

  return (
    <div className="space-y-6">
      {/* API Keys — grouped by service */}
      {ENV_VAR_GROUPS.map((group) => (
        <div key={group.service}>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
            {group.service}
          </h3>
          <div className="space-y-2">
            {group.vars.map(({ key, label }) => {
              const value = editedVars[key] ?? "";
              const isVisible = visibleKeys.has(key);
              const hasValue = value.length > 0;

              return (
                <div
                  key={key}
                  className="p-3 bg-bg-tertiary rounded-[2px] border border-border"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusDot ok={hasValue} />
                    <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                      {label}
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type={isVisible ? "text" : "password"}
                      value={value}
                      onChange={(e) => handleChange(key, e.target.value)}
                      placeholder="Not set"
                      spellCheck={false}
                      className="flex-1 bg-bg-primary border border-border text-text-primary text-sm font-mono px-2.5 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary placeholder:text-text-secondary/30"
                    />
                    <button
                      onClick={() => toggleVisibility(key)}
                      className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors shrink-0"
                      title={isVisible ? "Hide" : "Reveal"}
                    >
                      <EyeIcon open={isVisible} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Save button */}
      <div>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="w-full py-2 text-sm font-semibold uppercase tracking-wider rounded-[2px] transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-accent-primary text-bg-primary hover:brightness-110"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {saveResult && (
          <p
            className={`text-[10px] mt-1.5 text-center ${
              saveResult.startsWith("Error")
                ? "text-error"
                : "text-accent-tertiary"
            }`}
          >
            {saveResult}
          </p>
        )}
      </div>

      {/* Backend status */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Backend
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <span className="text-sm text-text-primary">Server</span>
          <StatusDot ok={backendOk} />
        </div>
      </div>

      {/* Export / Import */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Backup & Restore
        </h3>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
          >
            Export
          </button>
          <button
            onClick={handleImport}
            className="flex-1 py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
          >
            Import
          </button>
        </div>
        <p className="text-[10px] text-text-secondary/50 mt-1.5">
          Export saves registry, prompts, skills, memory, schedules, and triggers.
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Prompts Tab
// =============================================================================

function PromptsTab() {
  const [selectedAgentId, setSelectedAgentId] = useState("clyde-001");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Edit Prompt
        </h3>
        <PromptEditor
          key={`editor-${refreshKey}`}
          initialAgentId={selectedAgentId}
        />
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Version History
        </h3>
        <PromptHistoryViewer
          key={`history-${refreshKey}`}
          agentId={selectedAgentId}
          onRollback={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Proactive Mode Section (with countdown + trigger)
// =============================================================================

function ProactiveSection({
  settings,
  updateSetting,
}: {
  settings: RegistrySettings;
  updateSetting: (key: string, value: any) => void;
}) {
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch next run time
  const fetchNextRun = async () => {
    try {
      const res = await fetch(`${API_URL}/api/insights/next-run`);
      const data = await res.json();
      setNextRun(data.next_run_time || null);
    } catch {
      setNextRun(null);
    }
  };

  useEffect(() => {
    if (settings.proactive_mode_enabled) {
      fetchNextRun();
    }
  }, [settings.proactive_mode_enabled, settings.proactive_interval_hours]);

  // Countdown ticker
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!nextRun || !settings.proactive_mode_enabled) {
      setCountdown("");
      return;
    }

    const tick = () => {
      const now = Date.now();
      const target = new Date(nextRun).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setCountdown("Running now...");
        // Refetch in a few seconds to get the next scheduled time
        setTimeout(fetchNextRun, 5000);
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      if (h > 0) {
        setCountdown(`${h}h ${m}m ${s}s`);
      } else if (m > 0) {
        setCountdown(`${m}m ${s}s`);
      } else {
        setCountdown(`${s}s`);
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [nextRun, settings.proactive_mode_enabled]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch(`${API_URL}/api/insights/trigger`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.error) {
        setTriggerResult(`Error: ${data.error}`);
      } else {
        const count = data.new_insights_count || 0;
        setTriggerResult(
          count > 0
            ? `${count} new insight${count !== 1 ? "s" : ""} generated`
            : "No new insights found"
        );
      }
      // Refetch next run time after manual trigger
      fetchNextRun();
    } catch {
      setTriggerResult("Failed to trigger analysis");
    } finally {
      setTriggering(false);
      // Clear result after 4s
      setTimeout(() => setTriggerResult(null), 4000);
    }
  };

  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
        Proactive Mode
      </h3>
      <div className="space-y-3">
        {/* Toggle */}
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Enable proactive insights
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Clyde periodically analyses patterns and suggests improvements
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "proactive_mode_enabled",
                !settings.proactive_mode_enabled
              )
            }
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.proactive_mode_enabled
                ? "bg-accent-tertiary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.proactive_mode_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Interval selector */}
        <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <label className="text-sm text-text-primary block mb-2">
            Review interval
          </label>
          <select
            value={settings.proactive_interval_hours || 6}
            onChange={(e) =>
              updateSetting(
                "proactive_interval_hours",
                parseInt(e.target.value)
              )
            }
            disabled={!settings.proactive_mode_enabled}
            className="w-full bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value={1}>Every 1 hour</option>
            <option value={3}>Every 3 hours</option>
            <option value={6}>Every 6 hours</option>
            <option value={12}>Every 12 hours</option>
            <option value={24}>Every 24 hours</option>
          </select>
          <p className="text-[10px] text-text-secondary/50 mt-1.5">
            How often Clyde reviews system data for insights
          </p>

          {/* Countdown timer */}
          {settings.proactive_mode_enabled && countdown && (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border/50">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent-tertiary shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="text-[11px] font-mono text-accent-tertiary">
                {countdown}
              </span>
              <span className="text-[10px] text-text-secondary/40">
                until next review
              </span>
            </div>
          )}
        </div>

        {/* Run now button */}
        <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Run analysis now</p>
              <p className="text-[10px] text-text-secondary/60 mt-0.5">
                Trigger an immediate insight review
              </p>
            </div>
            <button
              onClick={handleTrigger}
              disabled={!settings.proactive_mode_enabled || triggering}
              className="px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-tertiary text-bg-primary rounded-[2px] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {triggering ? (
                <>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="animate-spin"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Running...
                </>
              ) : (
                <>
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
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Run Now
                </>
              )}
            </button>
          </div>

          {/* Trigger result feedback */}
          {triggerResult && (
            <p
              className={`text-[10px] mt-2 ${
                triggerResult.startsWith("Error") || triggerResult.startsWith("Failed")
                  ? "text-error"
                  : "text-accent-tertiary"
              }`}
            >
              {triggerResult}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Controls Tab
// =============================================================================

function ControlsTab() {
  const [settings, setSettings] = useState<RegistrySettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/registry/settings`);
        const data = await res.json();
        setSettings(data);
      } catch {
        // ignore
      }
    }
    load();
  }, []);

  async function updateSetting(key: string, value: any) {
    if (!settings) return;

    const updated = { ...settings, [key]: value };
    setSettings(updated as RegistrySettings);
    setSaving(true);

    try {
      await fetch(`${API_URL}/api/registry/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="text-[11px] text-text-secondary/50 py-4 text-center">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Self-Edit Toggle */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Self-Improvement
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Allow Clyde to self-edit
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Clyde can rewrite subagent system prompts to improve performance
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "self_edit_enabled",
                !settings.self_edit_enabled
              )
            }
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.self_edit_enabled
                ? "bg-accent-primary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.self_edit_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Concurrency Cap */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Concurrency
        </h3>
        <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-text-primary">
              Max concurrent agents
            </p>
            <span className="text-sm font-mono text-accent-primary">
              {settings.concurrency_cap}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={settings.concurrency_cap}
            onChange={(e) =>
              updateSetting("concurrency_cap", parseInt(e.target.value))
            }
            className="w-full accent-accent-primary"
          />
          <div className="flex justify-between text-[10px] text-text-secondary/50 mt-1">
            <span>1</span>
            <span>10</span>
          </div>
        </div>
      </div>

      {/* Cost Alert Threshold */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Cost Alerts
        </h3>
        <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <label className="text-sm text-text-primary block mb-2">
            Daily spend alert ($)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">$</span>
            <input
              type="number"
              min={0}
              step={5}
              value={settings.cost_alert_threshold_usd || ""}
              onChange={(e) =>
                updateSetting(
                  "cost_alert_threshold_usd",
                  parseFloat(e.target.value) || 0
                )
              }
              placeholder="0 (disabled)"
              className="flex-1 bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
            />
          </div>
          <p className="text-[10px] text-text-secondary/50 mt-1.5">
            Set to 0 to disable alerts
          </p>
        </div>
      </div>

      {/* File Uploads */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          File Uploads
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Save uploaded files
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Keep files attached via chat in the uploads folder. When off, files are deleted after processing.
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "save_uploads_enabled",
                !settings.save_uploads_enabled
              )
            }
            className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
              settings.save_uploads_enabled
                ? "bg-accent-primary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.save_uploads_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Prompt Caching */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Prompt Caching
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Enable prompt caching
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Keeps system prompts cache-friendly by moving volatile data (timestamps, session context) to messages. Reduces cost and latency.
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "prompt_caching_enabled",
                !settings.prompt_caching_enabled
              )
            }
            className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
              settings.prompt_caching_enabled
                ? "bg-accent-primary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.prompt_caching_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-[10px] text-text-secondary/50 mt-1.5">
          Takes effect on next new chat session
        </p>
      </div>

      {/* Sleep Prevention */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Sleep Prevention
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Prevent device sleep
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Keeps the host machine awake while the backend is running. Required for schedules and triggers to fire reliably.
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "prevent_sleep_enabled",
                !settings.prevent_sleep_enabled
              )
            }
            className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
              settings.prevent_sleep_enabled
                ? "bg-accent-primary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.prevent_sleep_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-[10px] text-text-secondary/50 mt-1.5">
          Uses caffeinate on macOS, SetThreadExecutionState on Windows
        </p>
      </div>

      {/* Proactive Mode */}
      <ProactiveSection settings={settings} updateSetting={updateSetting} />

      {saving && (
        <p className="text-[10px] text-text-secondary/50 text-center">
          Saving...
        </p>
      )}
    </div>
  );
}
