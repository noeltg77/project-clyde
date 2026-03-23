"use client";

import { memo } from "react";
import { motion } from "motion/react";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { ModelBadge } from "@/components/agents/ModelBadge";
import type { Message } from "@/stores/chat-store";

type AgentActivityBubbleProps = {
  message: Message;
};

export const AgentActivityBubble = memo(function AgentActivityBubble({
  message,
}: AgentActivityBubbleProps) {
  const activity = message.activityStatus;
  if (!activity) return null;

  const isWorking = activity.phase === "working";
  const isComplete = activity.phase === "complete";

  const modelTier =
    (message.metadata?.model_tier as "opus" | "sonnet" | "haiku") || "sonnet";

  const agentRole = message.metadata?.agent_role as string | undefined;

  const borderColorClass =
    modelTier === "opus"
      ? "border-accent-primary"
      : modelTier === "sonnet"
      ? "border-accent-tertiary"
      : "border-text-secondary/30";

  // Format duration
  const durationLabel = activity.durationMs
    ? activity.durationMs >= 60000
      ? `${Math.round(activity.durationMs / 60000)}m ${Math.round((activity.durationMs % 60000) / 1000)}s`
      : `${Math.round(activity.durationMs / 1000)} seconds`
    : null;

  // Format token count
  const tokenLabel = activity.tokenCount
    ? `${activity.tokenCount.toLocaleString()} tokens`
    : null;

  const statsText = [tokenLabel, durationLabel].filter(Boolean).join(" · ");

  return (
    <div className="flex gap-3 mb-4">
      <div className="relative" style={{ width: 40, height: 40 }}>
        <AgentAvatar
          src={message.agentAvatar || undefined}
          name={message.agentName || "Agent"}
          size={40}
          modelTier={modelTier}
        />
        {/* Completion checkmark overlay */}
        {isComplete && (
          <motion.div
            className="absolute -bottom-0.5 -right-0.5 z-10 w-[18px] h-[18px] rounded-full bg-green-500 flex items-center justify-center border-2 border-bg-primary"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
        )}
      </div>

      <div className="flex-1 max-w-[80%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-text-primary">
            {message.agentName || "Agent"}
          </span>
          <ModelBadge model={modelTier} role={agentRole} />
        </div>

        <div
          className={`bg-bg-secondary border-l-2 ${borderColorClass} rounded-[2px] px-4 py-3`}
        >
          <div className="flex items-center gap-2">
            {isWorking && (
              <motion.div
                className="w-2 h-2 rounded-full bg-accent-tertiary flex-shrink-0"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <p className="text-sm text-text-primary">{message.content}</p>
          </div>

          {/* Stats line for completed activities */}
          {isComplete && statsText && (
            <p className="text-[11px] text-text-secondary mt-1">{statsText}</p>
          )}
        </div>
      </div>
    </div>
  );
});
