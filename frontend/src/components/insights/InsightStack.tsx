"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { springs } from "@/lib/design-tokens";
import { useInsightStore } from "@/stores/insight-store-provider";
import { useChatStore } from "@/stores/chat-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";

export function InsightStack() {
  const pendingCount = useInsightStore((s) => s.pendingCount);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const activeView = useSettingsStore((s) => s.activeView);

  const [dismissed, setDismissed] = useState(false);
  const prevCountRef = useRef(pendingCount);

  // Reset dismissed state when NEW insights arrive (count goes up)
  useEffect(() => {
    if (pendingCount > prevCountRef.current) {
      setDismissed(false);
    }
    prevCountRef.current = pendingCount;
  }, [pendingCount]);

  // Also hide when the user is already viewing insights
  const visible =
    !dismissed &&
    !isStreaming &&
    pendingCount > 0 &&
    activeView !== "insights";

  const handleViewInsights = () => {
    setActiveView("insights");
    setDismissed(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ x: "110%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "110%", opacity: 0 }}
          transition={springs.snappy}
          className="fixed bottom-5 right-5 z-50"
        >
          <div className="w-[320px] bg-bg-secondary border border-border rounded-[2px] shadow-[4px_4px_0_0_rgba(200,255,0,0.08)] overflow-hidden">
            {/* Accent top bar */}
            <div className="h-[2px] bg-accent-primary/40" />

            <div className="p-3.5 flex items-start gap-3">
              {/* Clyde avatar */}
              <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 border border-accent-primary/30">
                <Image
                  src="/avatars/clyde.jpeg"
                  alt="Clyde"
                  fill
                  className="object-cover"
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-text-primary leading-tight mb-0.5">
                  Clyde has new insights
                </p>
                <p className="text-[11px] text-text-secondary/60 leading-snug mb-3">
                  {pendingCount} insight{pendingCount !== 1 ? "s" : ""} ready
                  for review
                </p>

                <button
                  onClick={handleViewInsights}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-primary text-bg-primary rounded-[2px] hover:brightness-110 transition-all"
                >
                  View Insights
                </button>
              </div>

              {/* Dismiss X */}
              <button
                onClick={handleDismiss}
                className="shrink-0 p-0.5 text-text-secondary/30 hover:text-text-secondary transition-colors"
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
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
