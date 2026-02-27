"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { springs } from "@/lib/design-tokens";
import type { PendingPermission } from "@/stores/agent-store";

type PermissionPopupProps = {
  permission: PendingPermission;
  onRespond: (id: string, decision: string) => void;
};

const TIMEOUT_SECONDS = 60;

export function PermissionPopup({
  permission,
  onRespond,
}: PermissionPopupProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(TIMEOUT_SECONDS);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onRespond(permission.id, "deny");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [permission.id, onRespond]);

  // Format tool input for display
  const inputDisplay = Object.entries(permission.toolInput)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={springs.snappy}
      className="w-80 bg-bg-secondary border-2 border-border rounded-[2px] shadow-[4px_4px_0_0_rgba(200,255,0,0.15)] overflow-hidden"
    >
      {/* Timeout progress bar */}
      <div className="h-1 bg-bg-tertiary">
        <motion.div
          className="h-full bg-accent-primary"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: TIMEOUT_SECONDS, ease: "linear" }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <AgentAvatar
          name={permission.agentName}
          size={32}
          modelTier={permission.modelTier}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {permission.agentName}
          </p>
          <p className="text-[11px] text-text-secondary">
            Permission Required
          </p>
        </div>
        <span className="text-[11px] text-text-secondary font-mono">
          {remainingSeconds}s
        </span>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Tool
          </span>
          <span className="text-sm font-mono text-accent-primary">
            {permission.toolName}
          </span>
        </div>

        {inputDisplay && (
          <div className="p-2 bg-bg-tertiary rounded-[2px] border border-border">
            <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
              {inputDisplay}
            </pre>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 p-3 pt-0">
        <button
          onClick={() => onRespond(permission.id, "allow")}
          className="flex-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider bg-accent-primary text-bg-primary rounded-[2px] hover:brightness-110 transition-all"
        >
          Allow
        </button>
        <button
          onClick={() => onRespond(permission.id, "deny")}
          className="flex-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider bg-error text-white rounded-[2px] hover:brightness-110 transition-all"
        >
          Deny
        </button>
        <button
          onClick={() => onRespond(permission.id, "allow_all_similar")}
          className="flex-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider bg-bg-tertiary text-text-secondary border border-border rounded-[2px] hover:text-text-primary hover:border-text-secondary transition-all"
        >
          Allow All
        </button>
      </div>
    </motion.div>
  );
}
