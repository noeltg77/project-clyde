"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type HistoryEntry = {
  id: string;
  agent_id: string;
  previous_version: string;
  new_version: string;
  reason: string;
  changed_by: string;
  created_at: string;
};

type PromptHistoryViewerProps = {
  agentId: string;
  /** Callback after a rollback so parent can refresh prompt content */
  onRollback?: () => void;
};

export function PromptHistoryViewer({
  agentId,
  onRollback,
}: PromptHistoryViewerProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  async function fetchHistory() {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/prompts/${agentId}/history`
      );
      const data = await res.json();
      setHistory(data.history || []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, [agentId]);

  async function handleRollback(versionId: string) {
    setRollingBack(versionId);
    try {
      const res = await fetch(
        `${API_URL}/api/prompts/${agentId}/rollback/${versionId}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success) {
        await fetchHistory();
        onRollback?.();
      }
    } catch {
      // ignore
    } finally {
      setRollingBack(null);
    }
  }

  if (loading && history.length === 0) {
    return (
      <div className="text-[11px] text-text-secondary/50 py-4 text-center">
        Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-[11px] text-text-secondary/50 py-4 text-center">
        No version history yet. Changes will appear here after edits.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const date = new Date(entry.created_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div
            key={entry.id}
            className="bg-bg-tertiary border border-border rounded-[2px] overflow-hidden"
          >
            {/* Header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] ${
                    entry.changed_by === "clyde"
                      ? "bg-accent-primary/20 text-accent-primary"
                      : "bg-text-secondary/20 text-text-secondary"
                  }`}
                >
                  {entry.changed_by}
                </span>
                <span className="text-[11px] text-text-primary truncate">
                  {entry.reason}
                </span>
              </div>
              <span className="text-[10px] text-text-secondary/50 whitespace-nowrap ml-2">
                {date}
              </span>
            </button>

            {/* Expanded diff */}
            {isExpanded && (
              <div className="border-t border-border px-3 py-2 space-y-2">
                <DiffView
                  oldText={entry.previous_version}
                  newText={entry.new_version}
                />
                <button
                  onClick={() => handleRollback(entry.id)}
                  disabled={rollingBack === entry.id}
                  className="text-[11px] font-semibold text-accent-secondary hover:text-accent-secondary/80 transition-colors disabled:opacity-50"
                >
                  {rollingBack === entry.id
                    ? "Rolling back..."
                    : "↩ Rollback to this version"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Simple line-by-line diff viewer. No external library needed.
 */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);

  // Simple line-by-line comparison
  const diffLines: { type: "same" | "added" | "removed"; text: string }[] = [];

  // Use a basic LCS-like approach: compare line by line
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      diffLines.push({ type: "added", text: newLines[ni] });
      ni++;
    } else if (ni >= newLines.length) {
      diffLines.push({ type: "removed", text: oldLines[oi] });
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      diffLines.push({ type: "same", text: oldLines[oi] });
      oi++;
      ni++;
    } else {
      // Check if old line appears soon in new (removal) or vice versa
      const newLookAhead = newLines.slice(ni, ni + 5).indexOf(oldLines[oi]);
      const oldLookAhead = oldLines.slice(oi, oi + 5).indexOf(newLines[ni]);

      if (newLookAhead >= 0 && (oldLookAhead < 0 || newLookAhead <= oldLookAhead)) {
        // Lines were added before the current old line
        for (let j = 0; j < newLookAhead; j++) {
          diffLines.push({ type: "added", text: newLines[ni + j] });
        }
        ni += newLookAhead;
      } else if (oldLookAhead >= 0) {
        // Lines were removed before the current new line
        for (let j = 0; j < oldLookAhead; j++) {
          diffLines.push({ type: "removed", text: oldLines[oi + j] });
        }
        oi += oldLookAhead;
      } else {
        // Treat as a replacement
        diffLines.push({ type: "removed", text: oldLines[oi] });
        diffLines.push({ type: "added", text: newLines[ni] });
        oi++;
        ni++;
      }
    }
  }

  // Only show lines that changed (with a few context lines)
  const contextSize = 2;
  const changedIndices = new Set<number>();
  diffLines.forEach((line, i) => {
    if (line.type !== "same") {
      for (let j = Math.max(0, i - contextSize); j <= Math.min(diffLines.length - 1, i + contextSize); j++) {
        changedIndices.add(j);
      }
    }
  });

  if (changedIndices.size === 0) {
    return (
      <p className="text-[10px] text-text-secondary/50 italic">
        No differences
      </p>
    );
  }

  return (
    <div className="max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed">
      {diffLines.map((line, i) => {
        if (!changedIndices.has(i)) return null;

        const bgClass =
          line.type === "added"
            ? "bg-accent-tertiary/15 text-accent-tertiary"
            : line.type === "removed"
            ? "bg-error/15 text-error/80"
            : "text-text-secondary/60";

        const prefix =
          line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";

        return (
          <div key={i} className={`px-1 ${bgClass}`}>
            <span className="select-none opacity-50 mr-1">{prefix}</span>
            {line.text || " "}
          </div>
        );
      })}
    </div>
  );
}
