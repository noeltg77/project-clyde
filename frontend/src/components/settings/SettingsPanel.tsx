"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { useAgentStore } from "@/stores/agent-store-provider";
import type { Agent } from "@/stores/agent-store";
import { springs } from "@/lib/design-tokens";
import { PromptEditor } from "./PromptEditor";
import { PromptHistoryViewer } from "./PromptHistoryViewer";
import { TeamExportModal } from "./TeamExportModal";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Tab = "system" | "prompts" | "controls";

type RegistrySettings = {
  clyde_model: "opus" | "sonnet" | "haiku";
  agent_provider: "anthropic" | "openrouter";
  openrouter_model: string;
  openrouter_subagent_model: string;
  self_edit_enabled: boolean;
  concurrency_cap: number;
  max_team_size: number;
  cost_alert_threshold_usd: number;
  proactive_mode_enabled: boolean;
  proactive_interval_hours: number;
  save_uploads_enabled: boolean;
  prompt_caching_enabled: boolean;
  prevent_sleep_enabled: boolean;
  debug_mode_enabled: boolean;
  telegram_enabled: boolean;
  telegram_mode: "polling" | "webhook";
  telegram_webhook_url: string;
  telegram_polling_interval: number;
  telegram_allowed_user_ids: number[];
};

const MODEL_OPTIONS = [
  { value: "opus" as const, label: "Opus", color: "#C8FF00", desc: "Most capable — highest quality reasoning" },
  { value: "sonnet" as const, label: "Sonnet", color: "#00D4AA", desc: "Balanced — fast with strong performance" },
  { value: "haiku" as const, label: "Haiku", color: "#A0A090", desc: "Fastest — lightweight and cost-efficient" },
];

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
    service: "Google (Gemini)",
    vars: [{ key: "GEMINI_API_KEY", label: "API Key" }],
  },
  {
    service: "OpenAI",
    vars: [{ key: "OPENAI_API_KEY", label: "API Key" }],
  },
  {
    service: "OpenRouter",
    vars: [{ key: "OPENROUTER_API_KEY", label: "API Key" }],
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

  // Team export state
  const [showTeamExport, setShowTeamExport] = useState(false);

  // Restart prompt state
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Migration state
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [promptFile, setPromptFile] = useState<File | null>(null);
  const [registryFile, setRegistryFile] = useState<File | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    success?: boolean;
    teams_created?: number;
    agents_migrated?: number;
    workflows_extracted?: number;
    prompt_updated?: boolean;
    error?: string;
  } | null>(null);

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

        if (data.restarting) {
          // Backend is restarting — poll health until it's back
          setSaveResult("Saved — restarting backend...");
          setSaving(false);
          await pollBackendHealth();
        } else {
          setSaveResult("Saved successfully.");
          setSaving(false);
          setTimeout(() => setSaveResult(null), 5000);
        }
      } else {
        setSaveResult(`Error: ${data.error || "Failed to save"}`);
        setSaving(false);
        setTimeout(() => setSaveResult(null), 5000);
      }
    } catch {
      setSaveResult("Error: Could not reach backend");
      setSaving(false);
      setTimeout(() => setSaveResult(null), 5000);
    }
  }

  async function pollBackendHealth() {
    const maxAttempts = 15;
    const intervalMs = 1500;

    // Wait briefly for uvicorn to begin its restart
    await new Promise((r) => setTimeout(r, 1000));

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
        if (res.ok) {
          setSaveResult("Backend restarted successfully.");
          setBackendOk(true);
          setTimeout(() => setSaveResult(null), 5000);
          return;
        }
      } catch {
        // Expected — backend is still restarting
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    setSaveResult("Backend may still be restarting. Refresh if needed.");
    setTimeout(() => setSaveResult(null), 8000);
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      await fetch(`${API_URL}/api/system/restart`, { method: "POST" });
      setShowRestartPrompt(false);
      setSaveResult("Restarting backend...");
      await pollBackendHealth();
    } catch {
      setSaveResult("Error: Could not trigger restart");
      setTimeout(() => setSaveResult(null), 5000);
    } finally {
      setRestarting(false);
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

        // Detect .clyde team package vs full system export
        if (data.clyde_package_version && data.team) {
          const res = await fetch(`${API_URL}/api/teams/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          const result = await res.json();
          if (result.success) {
            alert(
              `Team "${result.team_name}" imported with ${result.agents_imported} agent(s). Refreshing...`
            );
            window.location.reload();
          } else {
            alert(`Import failed: ${result.error || "Unknown error"}`);
          }
        } else {
          // Full system import
          const res = await fetch(`${API_URL}/api/system/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          const result = await res.json();
          if (result.success) {
            setShowRestartPrompt(true);
          } else {
            alert(`Import failed: ${result.error || "Unknown error"}`);
          }
        }
      } catch {
        alert("Failed to parse import file");
      }
    };
    input.click();
  }

  async function handleMigration() {
    if (!promptFile || !registryFile) return;

    setMigrating(true);
    setMigrateResult(null);

    try {
      const promptText = await promptFile.text();
      const registryText = await registryFile.text();

      let registryData: Record<string, unknown>;
      try {
        registryData = JSON.parse(registryText);
      } catch {
        setMigrateResult({ error: "Invalid JSON in registry file." });
        setMigrating(false);
        return;
      }

      const res = await fetch(`${API_URL}/api/system/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registry: registryData, prompt: promptText }),
      });

      const data = await res.json();
      setMigrateResult(data);
    } catch {
      setMigrateResult({ error: "Could not reach backend." });
    } finally {
      setMigrating(false);
    }
  }

  function openMigrateModal() {
    setPromptFile(null);
    setRegistryFile(null);
    setMigrateResult(null);
    setMigrating(false);
    setShowMigrateModal(true);
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
                : saveResult.includes("restarting")
                  ? "text-amber-400"
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
        <button
          onClick={() => setShowTeamExport(true)}
          className="w-full mt-2 py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
        >
          Export Team
        </button>
        <p className="text-[10px] text-text-secondary/50 mt-1">
          Export a single team as a .clyde package for sharing or marketplace.
        </p>
        <TeamExportModal
          isOpen={showTeamExport}
          onClose={() => setShowTeamExport(false)}
        />
      </div>

      {/* Restart Prompt Modal */}
      <AnimatePresence>
        {showRestartPrompt && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[60]"
              onClick={() => setShowRestartPrompt(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={springs.snappy}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] bg-bg-secondary border border-border rounded-[4px] z-[61] flex flex-col"
            >
              <div className="px-5 pt-5 pb-3 border-b border-border">
                <h2 className="text-sm font-semibold text-text-primary">
                  Restart Required
                </h2>
                <p className="text-[10px] text-text-secondary/60 mt-1">
                  Import successful. The backend needs to restart to apply changes.
                </p>
              </div>
              <div className="px-5 pb-5 pt-4 flex gap-2">
                <button
                  onClick={() => setShowRestartPrompt(false)}
                  className="flex-1 py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
                >
                  Later
                </button>
                <button
                  onClick={handleRestart}
                  disabled={restarting}
                  className="flex-1 py-2 bg-accent-primary text-bg-primary text-sm font-semibold rounded-[2px] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {restarting ? "Restarting..." : "Restart Now"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Migrate Legacy System */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Migrate Legacy System
        </h3>
        <p className="text-[10px] text-text-secondary/50 mb-2">
          Upload your old Clyde prompt and registry.json to migrate to the new team file architecture.
        </p>
        <button
          onClick={openMigrateModal}
          className="w-full py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
        >
          Migrate
        </button>
      </div>

      {/* Migration Modal */}
      <AnimatePresence>
        {showMigrateModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => !migrating && setShowMigrateModal(false)}
            />

            {/* Modal content */}
            <motion.div
              className="relative w-full max-w-md mx-4 bg-bg-secondary border border-border rounded-[2px] p-6"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={springs.snappy}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-text-primary">
                  Migrate Legacy System
                </h2>
                <button
                  onClick={() => !migrating && setShowMigrateModal(false)}
                  className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Upload: Clyde Prompt */}
              <div className="mb-4">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-1.5 block">
                  Clyde Prompt (.md)
                </label>
                <label
                  className={`block border-2 border-dashed rounded-[2px] p-4 text-center cursor-pointer transition-colors ${
                    promptFile
                      ? "border-accent-primary/50 bg-accent-primary/5"
                      : "border-border hover:border-accent-primary bg-bg-tertiary"
                  }`}
                >
                  <input
                    type="file"
                    accept=".md,.txt"
                    className="hidden"
                    onChange={(e) => setPromptFile(e.target.files?.[0] ?? null)}
                  />
                  {promptFile ? (
                    <span className="text-xs text-accent-primary font-medium">
                      {promptFile.name}
                    </span>
                  ) : (
                    <span className="text-xs text-text-secondary/50">
                      Click to select file
                    </span>
                  )}
                </label>
              </div>

              {/* Upload: Registry JSON */}
              <div className="mb-5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-1.5 block">
                  Registry JSON (.json)
                </label>
                <label
                  className={`block border-2 border-dashed rounded-[2px] p-4 text-center cursor-pointer transition-colors ${
                    registryFile
                      ? "border-accent-primary/50 bg-accent-primary/5"
                      : "border-border hover:border-accent-primary bg-bg-tertiary"
                  }`}
                >
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => setRegistryFile(e.target.files?.[0] ?? null)}
                  />
                  {registryFile ? (
                    <span className="text-xs text-accent-primary font-medium">
                      {registryFile.name}
                    </span>
                  ) : (
                    <span className="text-xs text-text-secondary/50">
                      Click to select file
                    </span>
                  )}
                </label>
              </div>

              {/* Run Migration button */}
              <button
                onClick={handleMigration}
                disabled={!promptFile || !registryFile || migrating}
                className="w-full py-2.5 text-sm font-semibold uppercase tracking-wider rounded-[2px] transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-accent-primary text-bg-primary hover:brightness-110"
              >
                {migrating ? "Migrating..." : "Run Migration"}
              </button>

              {/* Result display */}
              {migrateResult && (
                <div
                  className={`mt-4 p-3 rounded-[2px] border text-xs ${
                    migrateResult.error
                      ? "border-error/30 bg-error/5 text-error"
                      : "border-accent-tertiary/30 bg-accent-tertiary/5 text-accent-tertiary"
                  }`}
                >
                  {migrateResult.error ? (
                    <p>{migrateResult.error}</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold">Migration complete</p>
                      <p>{migrateResult.teams_created} team{migrateResult.teams_created !== 1 ? "s" : ""} created</p>
                      <p>{migrateResult.agents_migrated} agent{migrateResult.agents_migrated !== 1 ? "s" : ""} migrated</p>
                      {(migrateResult.workflows_extracted ?? 0) > 0 && (
                        <p>{migrateResult.workflows_extracted} workflow{migrateResult.workflows_extracted !== 1 ? "s" : ""} extracted</p>
                      )}
                      {migrateResult.prompt_updated && <p>System prompt updated</p>}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
// Telegram Bot Section
// =============================================================================

function TelegramSection({
  settings,
  updateSetting,
}: {
  settings: RegistrySettings;
  updateSetting: (key: string, value: any) => void;
}) {
  const [telegramStatus, setTelegramStatus] = useState<{
    running: boolean;
    mode: string | null;
    active_chats: number;
  } | null>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const ids = settings.telegram_allowed_user_ids;
  const [allowedIdsInput, setAllowedIdsInput] = useState(
    Array.isArray(ids) ? ids.join(", ") : String(ids || "")
  );

  // Fetch status and token on mount / when enabled changes
  useEffect(() => {
    fetch(`${API_URL}/api/telegram/status`)
      .then((r) => r.json())
      .then(setTelegramStatus)
      .catch(() => {});
  }, [settings.telegram_enabled]);

  useEffect(() => {
    if (tokenLoaded) return;
    fetch(`${API_URL}/api/env-vars`)
      .then((r) => r.json())
      .then((d) => {
        setTelegramToken(d.vars?.TELEGRAM_BOT_TOKEN || "");
        setTokenLoaded(true);
      })
      .catch(() => {});
  }, [tokenLoaded]);

  // Refresh status periodically when enabled
  useEffect(() => {
    if (!settings.telegram_enabled) return;
    const interval = setInterval(() => {
      fetch(`${API_URL}/api/telegram/status`)
        .then((r) => r.json())
        .then(setTelegramStatus)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [settings.telegram_enabled]);

  async function saveToken() {
    if (savingToken) return;
    setSavingToken(true);
    try {
      await fetch(`${API_URL}/api/env-vars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TELEGRAM_BOT_TOKEN: telegramToken }),
      });
    } catch {
      // ignore
    } finally {
      setSavingToken(false);
    }
  }

  const mode = settings.telegram_mode || "polling";

  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
        Telegram Bot
      </h3>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-text-primary">
              Enable Telegram bot
            </p>
            {settings.telegram_enabled && telegramStatus && (
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    telegramStatus.running
                      ? "bg-accent-tertiary"
                      : "bg-error"
                  }`}
                />
                <span className="text-[10px] text-text-secondary/60">
                  {telegramStatus.running
                    ? `Connected (${telegramStatus.mode})`
                    : "Disconnected"}
                </span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-text-secondary/60 mt-0.5">
            Chat with Clyde from anywhere via Telegram
          </p>
        </div>
        <button
          onClick={() =>
            updateSetting("telegram_enabled", !settings.telegram_enabled)
          }
          className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
            settings.telegram_enabled
              ? "bg-accent-primary"
              : "bg-border"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
              settings.telegram_enabled
                ? "translate-x-5"
                : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Configuration (shown when enabled or has token) */}
      {(settings.telegram_enabled || telegramToken) && (
        <div className="mt-3 space-y-3">
          {/* Bot Token */}
          <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
            <label className="text-sm text-text-primary block mb-2">
              Bot Token
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                onBlur={saveToken}
                placeholder="Paste token from @BotFather"
                className="flex-1 bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
              />
              {savingToken && (
                <span className="text-[10px] text-text-secondary/50">
                  Saving...
                </span>
              )}
            </div>
            <p className="text-[10px] text-text-secondary/50 mt-1.5">
              Create a bot via{" "}
              <span className="text-text-secondary">@BotFather</span> on
              Telegram and paste the token here
            </p>
          </div>

          {/* Mode Selector */}
          <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
            <label className="text-sm text-text-primary block mb-2">
              Connection Mode
            </label>
            <div className="flex gap-2">
              {(
                [
                  {
                    value: "polling" as const,
                    label: "Polling",
                    desc: "Works behind NAT/firewalls (recommended)",
                  },
                  {
                    value: "webhook" as const,
                    label: "Webhook",
                    desc: "Requires public URL (VPS/cloud)",
                  },
                ] as const
              ).map((opt) => {
                const isSelected = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() =>
                      updateSetting("telegram_mode", opt.value)
                    }
                    className={`flex-1 p-3 rounded-[2px] border-2 transition-all text-left ${
                      isSelected
                        ? "bg-bg-tertiary border-accent-primary"
                        : "bg-bg-tertiary/50 border-border hover:border-text-secondary/30"
                    }`}
                  >
                    <p className="text-sm font-semibold text-text-primary">
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-text-secondary/60 mt-0.5">
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Webhook URL (shown in webhook mode) */}
          {mode === "webhook" && (
            <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
              <label className="text-sm text-text-primary block mb-2">
                Webhook URL
              </label>
              <input
                type="text"
                value={settings.telegram_webhook_url || ""}
                onChange={(e) =>
                  updateSetting("telegram_webhook_url", e.target.value)
                }
                placeholder="https://your-server.com"
                className="w-full bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
              />
              <p className="text-[10px] text-text-secondary/50 mt-1.5">
                Your server&apos;s public URL — /api/telegram/webhook will be
                appended automatically
              </p>
            </div>
          )}

          {/* Polling Interval (shown in polling mode) */}
          {mode === "polling" && (
            <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
              <label className="text-sm text-text-primary block mb-2">
                Polling interval (seconds)
              </label>
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={settings.telegram_polling_interval || 1}
                onChange={(e) =>
                  updateSetting(
                    "telegram_polling_interval",
                    parseFloat(e.target.value) || 1
                  )
                }
                className="w-24 bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
              />
              <p className="text-[10px] text-text-secondary/50 mt-1.5">
                How often to check for new messages (lower = faster response,
                higher = less bandwidth)
              </p>
            </div>
          )}

          {/* Allowed User IDs */}
          <div className="p-3 bg-bg-tertiary rounded-[2px] border border-border">
            <label className="text-sm text-text-primary block mb-2">
              Allowed User IDs
            </label>
            <input
              type="text"
              value={allowedIdsInput}
              onChange={(e) => setAllowedIdsInput(e.target.value)}
              onBlur={() =>
                updateSetting("telegram_allowed_user_ids", allowedIdsInput)
              }
              placeholder="e.g. 123456789, 987654321"
              className="w-full bg-bg-primary border border-border text-text-primary text-sm font-mono px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
            />
            <p className="text-[10px] text-text-secondary/50 mt-1.5">
              Comma-separated Telegram user IDs. Leave empty to allow anyone.
              Send /start to{" "}
              <span className="text-text-secondary">@userinfobot</span> on
              Telegram to find your ID.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Controls Tab
// =============================================================================

function ControlsTab() {
  const [settings, setSettings] = useState<RegistrySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState("");
  const orchestrator = useAgentStore((s) => s.orchestrator);
  const setOrchestrator = useAgentStore((s) => s.setOrchestrator);
  const setDebugEnabled = useSettingsStore((s) => s.setDebugEnabled);

  const provider = settings?.agent_provider || "anthropic";

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/registry/settings`);
        const data = await res.json();
        setSettings(data);
        setDebugEnabled(!!data.debug_mode_enabled);
      } catch {
        // ignore
      }
    }
    load();
  }, [setDebugEnabled]);

  useEffect(() => {
    if (provider === "openrouter") {
      fetch(`${API_URL}/api/openrouter/models`)
        .then((r) => r.json())
        .then((d) => setOpenrouterModels(d.models || []))
        .catch(() => {});
    }
  }, [provider]);

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

      // When clyde_model changes, update the orchestrator in the agent store
      if (key === "clyde_model" && orchestrator) {
        setOrchestrator({ ...orchestrator, model: value as Agent["model"] });
      }

      // When agent_provider changes, update the orchestrator platform
      if (key === "agent_provider" && orchestrator) {
        const newPlatform: Agent["platform"] = value === "openrouter" ? "openrouter" : "claude";
        setOrchestrator({ ...orchestrator, platform: newPlatform });
      }

      // Sync debug setting to global store
      if (key === "debug_mode_enabled") {
        setDebugEnabled(value as boolean);
      }
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
      {/* Agent Provider Selector */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Agent Provider
        </h3>
        <div className="flex gap-2">
          {([
            { value: "anthropic" as const, label: "Anthropic", desc: "Claude Agent SDK" },
            { value: "openrouter" as const, label: "OpenRouter", desc: "LangChain Deep Agents" },
          ] as const).map((opt) => {
            const isSelected = provider === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => updateSetting("agent_provider", opt.value)}
                className={`flex-1 p-3 rounded-[2px] border-2 transition-all text-left ${
                  isSelected
                    ? "bg-bg-tertiary border-accent-primary"
                    : "bg-bg-tertiary/50 border-border hover:border-text-secondary/30"
                }`}
              >
                <p className="text-sm font-semibold text-text-primary">
                  {opt.label}
                </p>
                <p className="text-[10px] text-text-secondary/60 mt-0.5">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-text-secondary/50 mt-1.5">
          Changes apply to the next chat session
        </p>
      </div>

      {/* Model Selector — conditional on provider */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          {provider === "openrouter" ? "OpenRouter Model" : "Clyde Model"}
        </h3>

        {provider === "anthropic" ? (
          /* Anthropic: Opus / Sonnet / Haiku buttons */
          <div className="space-y-1.5">
            {MODEL_OPTIONS.map((opt) => {
              const isSelected = (settings.clyde_model || "opus") === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => updateSetting("clyde_model", opt.value)}
                  className={`w-full flex items-center gap-3 p-3 rounded-[2px] border-2 transition-all text-left ${
                    isSelected
                      ? "bg-bg-tertiary border-current"
                      : "bg-bg-tertiary/50 border-border hover:border-text-secondary/30"
                  }`}
                  style={isSelected ? { borderColor: opt.color } : undefined}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-text-secondary/60 mt-0.5">
                      {opt.desc}
                    </p>
                  </div>
                  {isSelected && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: opt.color }}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* OpenRouter: model dropdown + custom input */
          <div className="space-y-2">
            <div className="space-y-1.5">
              {openrouterModels.map((model) => {
                const isSelected = (settings.openrouter_model || "anthropic/claude-sonnet-4") === model;
                const shortName = model.split("/").pop() || model;
                const provider = model.split("/")[0] || "";
                return (
                  <button
                    key={model}
                    onClick={() => updateSetting("openrouter_model", model)}
                    className={`w-full flex items-center gap-3 p-3 rounded-[2px] border-2 transition-all text-left ${
                      isSelected
                        ? "bg-bg-tertiary border-accent-primary"
                        : "bg-bg-tertiary/50 border-border hover:border-text-secondary/30"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary">
                        {shortName}
                      </p>
                      <p className="text-[10px] text-text-secondary/60 mt-0.5">
                        {provider}
                      </p>
                    </div>
                    {isSelected && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-accent-primary"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Custom model input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Custom model slug (e.g. mistralai/mistral-large)"
                className="flex-1 px-3 py-2 text-xs bg-bg-tertiary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent-primary"
              />
              <button
                onClick={() => {
                  if (customModel.trim()) {
                    updateSetting("openrouter_model", customModel.trim());
                    setCustomModel("");
                  }
                }}
                disabled={!customModel.trim()}
                className="px-3 py-2 text-xs bg-accent-primary text-bg-primary rounded-[2px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                Set
              </button>
            </div>
          </div>
        )}

        <p className="text-[10px] text-text-secondary/50 mt-1.5">
          Changes apply to the next chat session
        </p>
      </div>

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

      {/* Telegram Bot */}
      <TelegramSection settings={settings} updateSetting={updateSetting} />

      {/* Debug Mode */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Debug
        </h3>
        <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[2px] border border-border">
          <div>
            <p className="text-sm text-text-primary">
              Show debug prompts
            </p>
            <p className="text-[10px] text-text-secondary/60 mt-0.5">
              Display the system and user prompts sent to the API below each response
            </p>
          </div>
          <button
            onClick={() =>
              updateSetting(
                "debug_mode_enabled",
                !settings.debug_mode_enabled
              )
            }
            className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
              settings.debug_mode_enabled
                ? "bg-accent-primary"
                : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-primary transition-transform ${
                settings.debug_mode_enabled
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {saving && (
        <p className="text-[10px] text-text-secondary/50 text-center">
          Saving...
        </p>
      )}
    </div>
  );
}
