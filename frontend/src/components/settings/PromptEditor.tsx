"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Agent = {
  id: string;
  name: string;
  role: string;
};

type PromptEditorProps = {
  /** If set, pre-select this agent on mount */
  initialAgentId?: string;
};

export function PromptEditor({ initialAgentId }: PromptEditorProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState(initialAgentId || "");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Fetch agents for the selector
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/agents`);
        const data = await res.json();
        const list: Agent[] = [];

        // Include Clyde (orchestrator)
        const orch = data.orchestrator;
        if (orch) {
          list.push({ id: orch.id, name: orch.name, role: orch.role });
        }

        // Include active subagents
        for (const a of data.agents || []) {
          if (a.status === "active" || a.status === "paused") {
            list.push({ id: a.id, name: a.name, role: a.role });
          }
        }

        setAgents(list);
        if (!selectedId && list.length > 0) {
          setSelectedId(list[0].id);
        }
      } catch {
        // ignore
      }
    }
    load();
  }, []);

  // Fetch prompt content when agent changes
  useEffect(() => {
    if (!selectedId) return;
    setSaved(false);
    setError("");

    async function loadPrompt() {
      try {
        const res = await fetch(
          `${API_URL}/api/prompts/${selectedId}/current`
        );
        const data = await res.json();
        setContent(data.content || "");
        setOriginalContent(data.content || "");
      } catch {
        setContent("");
        setOriginalContent("");
      }
    }
    loadPrompt();
  }, [selectedId]);

  const isDirty = content !== originalContent;

  async function handleSave() {
    if (!isDirty || !selectedId) return;
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch(`${API_URL}/api/prompts/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          reason: reason.trim() || "Manual edit",
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOriginalContent(content);
        setReason("");
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Agent selector */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary block mb-1.5">
          Agent
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full bg-bg-tertiary border border-border text-text-primary text-sm px-3 py-2 rounded-[2px] focus:outline-none focus:border-accent-primary"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.role}
            </option>
          ))}
        </select>
      </div>

      {/* Prompt textarea */}
      <div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-64 bg-bg-tertiary border border-border text-text-primary text-xs font-mono px-3 py-2 rounded-[2px] resize-y focus:outline-none focus:border-accent-primary"
          spellCheck={false}
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-text-secondary/50">
            {content.length.toLocaleString()} chars
          </span>
          {isDirty && (
            <span className="text-[10px] text-accent-secondary">
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      {/* Reason + Save */}
      {isDirty && (
        <div className="space-y-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for change (optional)"
            className="w-full bg-bg-tertiary border border-border text-text-primary text-sm px-3 py-1.5 rounded-[2px] focus:outline-none focus:border-accent-primary"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 bg-accent-primary text-bg-primary font-semibold text-sm rounded-[2px] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-error">{error}</p>
      )}
      {saved && (
        <p className="text-[11px] text-accent-tertiary">
          Saved and logged to version history
        </p>
      )}
    </div>
  );
}
