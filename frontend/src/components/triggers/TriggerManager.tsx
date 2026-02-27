"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderPicker } from "./FolderPicker";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Trigger = {
  id: string;
  name: string;
  watch_path: string;
  pattern: string;
  prompt: string;
  agent_name: string | null;
  enabled: boolean;
  created_at: string;
  fire_count: number;
};

const defaultFormData = {
  name: "",
  watch_path: "",
  pattern: "",
  prompt: "",
  agent_name: "",
};

export function TriggerManager() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...defaultFormData });

  const fetchTriggers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/triggers`);
      const data = await res.json();
      setTriggers(data.triggers || []);
    } catch (err) {
      console.error("Failed to fetch triggers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTriggers();
  }, [fetchTriggers]);

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/triggers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggle_enabled: true }),
        });
        await fetchTriggers();
      } catch (err) {
        console.error("Failed to toggle trigger:", err);
      }
    },
    [fetchTriggers]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_URL}/api/triggers/${id}`, { method: "DELETE" });
        await fetchTriggers();
      } catch (err) {
        console.error("Failed to delete trigger:", err);
      }
    },
    [fetchTriggers]
  );

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (
        !formData.name ||
        !formData.watch_path ||
        !formData.pattern ||
        !formData.prompt
      )
        return;

      try {
        const res = await fetch(`${API_URL}/api/triggers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            watch_path: formData.watch_path,
            pattern: formData.pattern,
            prompt: formData.prompt,
            agent_name: formData.agent_name || null,
          }),
        });
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setFormData({
          name: "",
          watch_path: "",
          pattern: "",
          prompt: "",
          agent_name: "",
        });
        setShowForm(false);
        await fetchTriggers();
      } catch (err) {
        console.error("Failed to create trigger:", err);
        setFormError("Failed to create trigger. Is the backend running?");
      }
    },
    [formData, fetchTriggers]
  );

  /* ── Edit handler — populate form from existing trigger ──── */

  const handleEdit = useCallback((t: Trigger) => {
    setFormData({
      name: t.name,
      watch_path: t.watch_path,
      pattern: t.pattern,
      prompt: t.prompt,
      agent_name: t.agent_name || "",
    });
    setEditingId(t.id);
    setShowForm(true);
    setFormError(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setFormData({ ...defaultFormData });
    setShowForm(false);
    setFormError(null);
  }, []);

  /* ── Update handler — PATCH existing trigger ──────────────── */

  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (
        !editingId ||
        !formData.name ||
        !formData.watch_path ||
        !formData.pattern ||
        !formData.prompt
      )
        return;

      try {
        const res = await fetch(`${API_URL}/api/triggers/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            watch_path: formData.watch_path,
            pattern: formData.pattern,
            prompt: formData.prompt,
            agent_name: formData.agent_name || null,
          }),
        });
        const data = await res.json();
        if (data.error) {
          setFormError(data.error);
          return;
        }
        setEditingId(null);
        setFormData({ ...defaultFormData });
        setShowForm(false);
        await fetchTriggers();
      } catch (err) {
        console.error("Failed to update trigger:", err);
        setFormError("Failed to update trigger. Is the backend running?");
      }
    },
    [editingId, formData, fetchTriggers]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary font-display">
            File Triggers
          </h2>
          <button
            onClick={() => {
              if (showForm) {
                // Cancel — reset form + editing state
                setShowForm(false);
                setEditingId(null);
                setFormData({ ...defaultFormData });
                setFormError(null);
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
            {showForm ? "Cancel" : "+ New Trigger"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* New trigger form — two-column layout */}
          {showForm && (
            <form
              onSubmit={editingId ? handleUpdate : handleCreate}
              className="p-5 bg-bg-tertiary rounded-[2px] border border-border space-y-4"
            >
              {formError && (
                <div className="px-3 py-2 text-sm text-error bg-error/10 border border-error/20 rounded-[2px] flex items-center justify-between">
                  <span>{formError}</span>
                  <button
                    type="button"
                    onClick={() => setFormError(null)}
                    className="text-error/70 hover:text-error text-xs ml-2"
                  >
                    dismiss
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5">
                    Trigger Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. CSV Processor"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, name: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="relative">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5">
                    Watch Path
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="e.g. uploads"
                      value={formData.watch_path}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          watch_path: e.target.value,
                        }))
                      }
                      className="flex-1 px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFolderPicker((v) => !v)}
                      className={`px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] border transition-colors shrink-0 ${
                        showFolderPicker
                          ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                          : "border-border text-text-secondary hover:text-text-primary hover:border-text-secondary"
                      }`}
                      title="Browse folders"
                    >
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
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                    </button>
                  </div>
                  <FolderPicker
                    open={showFolderPicker}
                    onClose={() => setShowFolderPicker(false)}
                    onSelect={(path) => {
                      setFormData((f) => ({ ...f, watch_path: path }));
                      setShowFolderPicker(false);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5">
                    File Pattern
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. *.csv"
                    value={formData.pattern}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, pattern: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5">
                    Agent (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Leave blank for Clyde"
                    value={formData.agent_name}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, agent_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60 mb-1.5">
                  Prompt
                </label>
                <textarea
                  placeholder="e.g. Read this file and summarise the key points"
                  value={formData.prompt}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, prompt: e.target.value }))
                  }
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent-primary resize-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-2 text-sm font-medium rounded-[2px] border border-accent-primary text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  {editingId ? "Update Trigger" : "Create Trigger"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-4 py-2 text-sm font-medium rounded-[2px] text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
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
          {!loading && triggers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-text-secondary/50">
                No triggers yet
              </p>
              <p className="text-[11px] text-text-secondary/30 mt-1">
                Create one above or ask Clyde to set up a file watcher
              </p>
            </div>
          )}

          {/* Trigger list */}
          {triggers.map((t) => (
            <div
              key={t.id}
              className="group p-4 rounded-[2px] bg-bg-tertiary border border-border hover:border-accent-primary/20 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-sm font-medium text-text-primary">
                      {t.name}
                    </p>
                    <span className="text-[10px] text-text-secondary/60 font-mono px-1.5 py-0.5 bg-bg-secondary rounded-[2px]">
                      {t.watch_path}/{t.pattern}
                    </span>
                  </div>
                  {/* Untruncated prompt */}
                  <p className="text-[12px] text-text-secondary/50 mt-1">
                    {t.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {/* Toggle button */}
                  <button
                    onClick={() => handleToggle(t.id)}
                    className={`w-9 h-5 rounded-full relative transition-colors ${
                      t.enabled
                        ? "bg-accent-primary/30"
                        : "bg-text-secondary/20"
                    }`}
                    title={t.enabled ? "Disable" : "Enable"}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                        t.enabled
                          ? "bg-accent-primary"
                          : "bg-text-secondary/50"
                      }`}
                      style={{ left: t.enabled ? "18px" : "3px" }}
                    />
                  </button>
                  {/* Edit button */}
                  <button
                    onClick={() => handleEdit(t)}
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
                    onClick={() => handleDelete(t.id)}
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
                {t.agent_name && (
                  <span className="text-[11px] text-accent-primary/70 font-medium">
                    {t.agent_name}
                  </span>
                )}
                <span className="text-[11px] text-text-secondary/40">
                  {t.fire_count} fire{t.fire_count !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
