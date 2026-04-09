"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { springs } from "@/lib/design-tokens";
import { ExternalLink } from "lucide-react";

const DISMISSED_KEY = "clyde-community-dismissed";
const SKOOL_URL = "https://www.skool.com/project-clyde-3650/about";

export function CommunityModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (!dismissed) setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const dismissPermanently = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, close]);

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop + centering wrapper */}
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          >
            {/* Modal */}
            <motion.div
              className="w-[90vw] max-w-[560px] border-2 border-border bg-bg-secondary rounded-[2px] overflow-hidden shadow-2xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={springs.snappy}
              onClick={(e) => e.stopPropagation()}
            >
            {/* 16:9 Image */}
            <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
              <img
                src="/community-banner.jpg"
                alt="Project Clyde Community"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Content */}
            <div className="px-6 py-5 flex flex-col items-center text-center gap-4">
              <h2 className="text-lg font-semibold text-text-primary tracking-wide">
                Join the Clyde Community
              </h2>
              <p className="text-sm text-text-secondary leading-relaxed max-w-[420px]">
                Connect with other Clyde users, share workflows, get help, and
                learn how to get the most out of your AI team. Completely free to
                join.
              </p>

              {/* CTA Button */}
              <a
                href={SKOOL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 bg-accent-primary text-bg-primary text-[11px] font-semibold uppercase tracking-wider rounded-[2px] hover:brightness-110 transition-all"
              >
                Join the Community
                <ExternalLink size={12} />
              </a>

              {/* Don't show again */}
              <button
                onClick={dismissPermanently}
                className="text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer underline underline-offset-2"
              >
                Don&apos;t show this again
              </button>
            </div>
            </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  );
}
