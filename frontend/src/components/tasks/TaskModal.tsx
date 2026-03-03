"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import type { Task, TaskColumn } from "@/stores/task-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FileEntry = {
  path: string;
  name: string;
  folder: string;
};

type AgentOption = {
  id: string;
  name: string;
  type: "agent" | "user" | "clyde";
};

type TaskModalProps = {
  task: Task | null; // null = create mode
  columns: TaskColumn[];
  defaultColumnId?: string; // pre-select column when creating
  onSave: (data: {
    title: string;
    description: string;
    column_id: string;
    assignee_type: string | null;
    assignee_id: string | null;
    assignee_name: string | null;
    linked_docs: { path: string; name: string }[];
  }) => void;
  onDelete?: () => void;
  onClose: () => void;
};

export function TaskModal({
  task,
  columns,
  defaultColumnId,
  onSave,
  onDelete,
  onClose,
}: TaskModalProps) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [columnId, setColumnId] = useState(
    task?.column_id || defaultColumnId || columns[0]?.id || ""
  );
  const [assigneeType, setAssigneeType] = useState<string | null>(
    task?.assignee_type || null
  );
  const [assigneeId, setAssigneeId] = useState<string | null>(
    task?.assignee_id || null
  );
  const [assigneeName, setAssigneeName] = useState<string | null>(
    task?.assignee_name || null
  );
  const [linkedDocs, setLinkedDocs] = useState<{ path: string; name: string }[]>(
    task?.linked_docs || []
  );

  // Agent/assignee options
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);

  // File picker
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileQuery, setFileQuery] = useState("");

  // Fetch agents for assignee dropdown
  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch(`${API_URL}/api/agents`);
        const data = await res.json();
        const options: AgentOption[] = [
          { id: "user", name: "User", type: "user" },
        ];
        if (data.orchestrator) {
          options.push({
            id: data.orchestrator.id,
            name: data.orchestrator.name,
            type: "clyde",
          });
        }
        for (const agent of data.agents || []) {
          options.push({
            id: agent.id || agent.registryId,
            name: agent.name,
            type: "agent",
          });
        }
        setAgentOptions(options);
      } catch {
        // Fallback
        setAgentOptions([
          { id: "user", name: "User", type: "user" },
          { id: "clyde", name: "Clyde", type: "clyde" },
        ]);
      }
    }
    fetchAgents();
  }, []);

  // Fetch file tree for doc linking
  useEffect(() => {
    async function fetchFiles() {
      try {
        const res = await fetch(`${API_URL}/api/files/tree`);
        const data = await res.json();
        setAllFiles(data.files || []);
      } catch {
        // Non-critical
      }
    }
    fetchFiles();
  }, []);

  const filteredFiles = allFiles.filter(
    (f) =>
      f.name.toLowerCase().includes(fileQuery.toLowerCase()) &&
      !linkedDocs.some((d) => d.path === f.path)
  );

  const handleAssigneeChange = useCallback(
    (value: string) => {
      if (value === "") {
        setAssigneeType(null);
        setAssigneeId(null);
        setAssigneeName(null);
        return;
      }
      const option = agentOptions.find((a) => a.id === value);
      if (option) {
        setAssigneeType(option.type);
        setAssigneeId(option.id);
        setAssigneeName(option.name);
      }
    },
    [agentOptions]
  );

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      column_id: columnId,
      assignee_type: assigneeType,
      assignee_id: assigneeId,
      assignee_name: assigneeName,
      linked_docs: linkedDocs,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.15 }}
        className="bg-bg-secondary border border-border rounded-[2px] w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-display font-semibold text-text-primary">
            {task ? "Edit Task" : "New Task"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Task description (optional)"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent-primary resize-none"
            />
          </div>

          {/* Column (status) */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Status
            </label>
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary focus:outline-none focus:border-accent-primary"
            >
              {columns.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Assignee
            </label>
            <select
              value={assigneeId || ""}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary focus:outline-none focus:border-accent-primary"
            >
              <option value="">Unassigned</option>
              {agentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                  {opt.type === "clyde"
                    ? " (Orchestrator)"
                    : opt.type === "user"
                    ? " (You)"
                    : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Linked Docs */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Linked Documents
            </label>

            {/* Current docs */}
            {linkedDocs.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {linkedDocs.map((doc) => (
                  <span
                    key={doc.path}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-accent-primary/10 text-accent-primary rounded-[2px] border border-accent-primary/30"
                  >
                    {doc.name}
                    <button
                      onClick={() =>
                        setLinkedDocs((prev) =>
                          prev.filter((d) => d.path !== doc.path)
                        )
                      }
                      className="hover:text-error"
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add doc button / picker */}
            {!showFilePicker ? (
              <button
                onClick={() => setShowFilePicker(true)}
                className="text-[11px] text-accent-primary hover:text-accent-primary/80 transition-colors"
              >
                + Add document
              </button>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Search files..."
                  autoFocus
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent-primary"
                  onBlur={() => {
                    // Delay to allow click on option
                    setTimeout(() => {
                      setShowFilePicker(false);
                      setFileQuery("");
                    }, 200);
                  }}
                />
                {filteredFiles.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 max-h-[150px] overflow-y-auto bg-bg-primary border border-border rounded-[2px]">
                    {filteredFiles.slice(0, 10).map((file) => (
                      <button
                        key={file.path}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors font-mono"
                        onMouseDown={() => {
                          setLinkedDocs((prev) => [
                            ...prev,
                            { path: file.path, name: file.name },
                          ]);
                          setShowFilePicker(false);
                          setFileQuery("");
                        }}
                      >
                        {file.path}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <div>
            {task && onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 text-[11px] font-semibold text-error hover:text-error/80 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="px-4 py-2 text-sm bg-accent-primary text-bg-primary font-semibold rounded-[2px] hover:bg-accent-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {task ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
