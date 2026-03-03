"use client";

import { AgentAvatar } from "@/components/agents/AgentAvatar";
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
};

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 bg-bg-secondary border border-border rounded-[2px] hover:border-text-secondary/40 transition-colors cursor-pointer group"
    >
      {/* Title */}
      <h4 className="text-sm font-semibold text-text-primary truncate">
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
          {task.assignee_type === "agent" ? (
            <AgentAvatar
              name={task.assignee_name}
              size={18}
            />
          ) : (
            <div className="w-[18px] h-[18px] rounded-full bg-bg-tertiary border border-border flex items-center justify-center">
              <span className="text-[8px] font-bold text-text-secondary">
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
    </button>
  );
}
