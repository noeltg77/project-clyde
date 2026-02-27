"use client";

import { memo, useState, useMemo } from "react";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { ModelBadge } from "@/components/agents/ModelBadge";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingIndicator } from "./StreamingIndicator";
import { FileAttachmentCard } from "./FileAttachmentCard";
import type { Message, MessageStep } from "@/stores/chat-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/* ─── Step icon by type ─── */
function StepIcon({ type }: { type: MessageStep["type"] }) {
  switch (type) {
    case "tool_use":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "agent_started":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "agent_stopped":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

/* ─── Steps dropdown ─── */
function StepsDropdown({ steps }: { steps: MessageStep[] }) {
  const [open, setOpen] = useState(false);

  if (steps.length === 0) return null;

  return (
    <div className="inline-flex items-center relative ml-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[11px] text-text-secondary/60 hover:text-text-secondary hover:bg-bg-tertiary transition-colors"
      >
        <span className="font-mono">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 w-[340px] max-h-[300px] overflow-y-auto bg-bg-tertiary border border-border rounded-[2px] shadow-lg">
          <div className="p-2 space-y-0.5">
            {steps.map((step, i) => {
              const time = new Date(step.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });

              return (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-[2px] hover:bg-bg-secondary/50"
                >
                  <div className="mt-0.5 text-text-secondary/50">
                    <StepIcon type={step.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-text-primary truncate">
                        {step.label}
                      </span>
                      <span className="text-[10px] text-text-secondary/40 font-mono flex-shrink-0">
                        {time}
                      </span>
                    </div>
                    {step.detail && (
                      <p className="text-[10px] text-text-secondary/50 font-mono truncate mt-0.5">
                        {step.detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Extract created file paths from Write tool steps ─── */
function extractCreatedFiles(steps: MessageStep[]): { path: string; name: string }[] {
  const files: { path: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (step.type !== "tool_use") continue;
    if (step.label !== "Write") continue;
    if (!step.detail) continue;

    // Extract file_path from the Python dict string: {'file_path': 'outputs/report.md', ...}
    // Handle both single and double quotes
    const match = step.detail.match(/file_path['"]\s*:\s*['"]([^'"]+)['"]/);
    if (!match) continue;

    let filePath = match[1];

    // If it's an absolute path, try to get the working-dir-relative portion
    // Paths may look like /Users/.../working/outputs/file.md or /working/outputs/file.md
    const workingIdx = filePath.indexOf("/working/");
    if (workingIdx !== -1) {
      filePath = filePath.slice(workingIdx + "/working/".length);
    } else if (filePath.startsWith("/")) {
      // Absolute path we can't resolve — use just the filename
      filePath = filePath.split("/").pop() || filePath;
    }

    if (seen.has(filePath)) continue;
    seen.add(filePath);

    const fileName = filePath.split("/").pop() || filePath;
    files.push({ path: filePath, name: fileName });
  }

  return files;
}

/* ─── Message Bubble ─── */
type MessageBubbleProps = {
  message: Message;
};

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[70%] bg-bg-tertiary rounded-[2px] px-4 py-3">
          <p className="text-sm text-text-primary whitespace-pre-wrap">
            {message.content}
          </p>
          <p className="text-[11px] text-text-secondary mt-2 text-right">
            {timestamp}
          </p>
        </div>
      </div>
    );
  }

  // Determine model tier from metadata or fallback based on agent name
  const modelTier =
    (message.metadata?.model_tier as "opus" | "sonnet" | "haiku") ||
    (message.agentName === "Clyde" || message.role === "clyde"
      ? "opus"
      : "sonnet");

  // Determine agent role from metadata
  const agentRole =
    (message.metadata?.agent_role as string) ||
    (message.agentName === "Clyde" || message.role === "clyde"
      ? "CEO"
      : undefined);

  // Border colour based on model tier
  const borderColorClass =
    modelTier === "opus"
      ? "border-accent-primary"
      : modelTier === "sonnet"
      ? "border-accent-secondary"
      : "border-text-secondary/30";

  const steps = message.steps || [];

  // Extract files created by Write tool in this message
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const createdFiles = useMemo(() => extractCreatedFiles(steps), [steps]);

  return (
    <div className="flex gap-3 mb-4">
      <AgentAvatar
        src={message.agentAvatar || "/avatars/clyde.jpeg"}
        name={message.agentName || "Clyde"}
        size={40}
        modelTier={modelTier}
      />
      <div className="flex-1 max-w-[80%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-text-primary">
            {message.agentName || "Clyde"}
          </span>
          <ModelBadge model={modelTier} role={agentRole} />
          {steps.length > 0 && <StepsDropdown steps={steps} />}
        </div>
        <div
          className={`bg-bg-secondary border-l-2 ${borderColorClass} rounded-[2px] px-4 py-3`}
        >
          <MarkdownRenderer content={message.content} />
          {message.isStreaming && <StreamingIndicator />}
          {/* File attachment cards for files created by agent */}
          {createdFiles.length > 0 && !message.isStreaming && (
            <div className="mt-2">
              {createdFiles.map((file) => (
                <FileAttachmentCard
                  key={file.path}
                  filePath={file.path}
                  fileName={file.name}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-text-secondary">{timestamp}</p>
            <div className="flex items-center gap-2">
              {message.costUsd !== undefined && message.costUsd > 0 && (
                <p className="text-[11px] text-text-secondary font-mono">
                  ${message.costUsd.toFixed(4)}
                </p>
              )}
              {!message.isStreaming && (
                <FeedbackThumbs
                  sessionId={message.sessionId}
                  messageTimestamp={message.createdAt}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function FeedbackThumbs({
  sessionId,
  messageTimestamp,
}: {
  sessionId: string;
  messageTimestamp: string;
}) {
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(
    null
  );

  async function handleFeedback(value: "positive" | "negative") {
    if (feedback === value) return;
    setFeedback(value);
    try {
      await fetch(`${API_URL}/api/performance/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message_timestamp: messageTimestamp,
          feedback: value,
        }),
      });
    } catch {
      // Non-critical — silently fail
    }
  }

  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      <button
        onClick={() => handleFeedback("positive")}
        className={`p-0.5 transition-colors ${
          feedback === "positive"
            ? "text-accent-primary"
            : "text-text-secondary/30 hover:text-text-secondary/60"
        }`}
        aria-label="Thumbs up"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
          <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
      </button>
      <button
        onClick={() => handleFeedback("negative")}
        className={`p-0.5 transition-colors ${
          feedback === "negative"
            ? "text-error"
            : "text-text-secondary/30 hover:text-text-secondary/60"
        }`}
        aria-label="Thumbs down"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
          <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
        </svg>
      </button>
    </span>
  );
}
