"use client";

import { useMemo, useState } from "react";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { useAgentStore } from "@/stores/agent-store-provider";
import type { Task } from "@/stores/task-store";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

type TaskCardProps = {
  task: Task;
  onClick: () => void;
  onDelete: (taskId: string) => void;
};

export function TaskCard({ task, onClick, onDelete }: TaskCardProps) {
  const orchestrator = useAgentStore((s) => s.orchestrator);
  const agents = useAgentStore((s) => s.agents);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Look up the avatar and model tier from the agent store
  const assigneeMeta = useMemo(() => {
    if (!task.assignee_name) return null;

    // Check orchestrator (Clyde)
    if (
      task.assignee_type === "clyde" ||
      orchestrator?.name === task.assignee_name
    ) {
      return {
        avatar: orchestrator?.avatar,
        model: orchestrator?.model || "opus",
      };
    }

    // Check registered agents
    const agent = agents.find(
      (a) =>
        a.name === task.assignee_name ||
        a.registryId === task.assignee_id
    );
    if (agent) {
      return { avatar: agent.avatar, model: agent.model || "sonnet" };
    }

    return null;
  }, [task.assignee_name, task.assignee_id, task.assignee_type, orchestrator, agents]);

  return (
    <>
      <div
        onClick={onClick}
        className="relative w-full text-left p-3 bg-bg-secondary border border-border rounded-[2px] hover:border-text-secondary/40 transition-colors cursor-pointer group"
      >
        {/* Trash icon — visible on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          className="absolute top-2 right-2 p-1 rounded-[2px] opacity-0 group-hover:opacity-100 text-text-secondary/40 hover:text-error hover:bg-error/10 transition-all"
          title="Delete task"
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
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>

        {/* Title */}
        <h4 className="text-sm font-semibold text-text-primary truncate pr-6">
          {task.title}
        </h4>

        {/* Description */}
        {task.description && (
          <p className="mt-1 text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
            {task.description}
          </p>
        )}

        {/* Assignee */}
        {task.assignee_name && (
          <div className="mt-2 flex items-center gap-1.5">
            {task.assignee_type === "agent" || task.assignee_type === "clyde" ? (
              <AgentAvatar
                src={assigneeMeta?.avatar}
                name={task.assignee_name}
                size={24}
                modelTier={assigneeMeta?.model as "opus" | "sonnet" | "haiku" | undefined}
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-bg-tertiary border border-border flex items-center justify-center">
                <span className="text-[9px] font-bold text-text-secondary">
                  {task.assignee_name[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <span className="text-[10px] text-text-secondary truncate">
              {task.assignee_name}
            </span>
          </div>
        )}

        {/* Linked docs */}
        {task.linked_docs && task.linked_docs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.linked_docs.map((doc) => (
              <span
                key={doc.path}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-bg-tertiary text-text-secondary rounded-[2px] border border-border/50 truncate max-w-[120px]"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {doc.name}
              </span>
            ))}
          </div>
        )}

        {/* Timestamps */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-text-secondary/60">
          <span>{timeAgo(task.created_at)}</span>
          {task.updated_at !== task.created_at && (
            <span>edited {timeAgo(task.updated_at)}</span>
          )}
        </div>
      </div>

      {/* Delete confirmation popup */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(false);
          }}
        >
          <div
            className="bg-bg-secondary border border-border rounded-[2px] p-5 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-text-primary">
              Delete task?
            </h3>
            <p className="mt-2 text-[12px] text-text-secondary leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-text-primary">
                {task.title}
              </span>
              ? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  onDelete(task.id);
                }}
                className="px-4 py-2 text-sm bg-error text-white font-semibold rounded-[2px] hover:bg-error/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
