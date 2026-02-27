"use client";

import { useCallback } from "react";
import { AnimatePresence } from "motion/react";
import { useAgentStore } from "@/stores/agent-store-provider";
import { PermissionPopup } from "./PermissionPopup";

type PermissionStackProps = {
  onRespond: (id: string, decision: string) => void;
};

export function PermissionStack({ onRespond }: PermissionStackProps) {
  const pendingPermissions = useAgentStore((s) => s.pendingPermissions);

  // Show max 3 at a time
  const visiblePermissions = pendingPermissions.slice(0, 3);
  const hiddenCount = Math.max(0, pendingPermissions.length - 3);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {hiddenCount > 0 && (
        <div className="text-[11px] text-text-secondary font-mono px-2 py-1 bg-bg-tertiary rounded-[2px] border border-border">
          +{hiddenCount} more pending
        </div>
      )}
      <AnimatePresence mode="popLayout">
        {visiblePermissions.map((perm) => (
          <PermissionPopup
            key={perm.id}
            permission={perm}
            onRespond={onRespond}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
