"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAgentStore } from "@/stores/agent-store-provider";
import { AgentAvatar } from "./AgentAvatar";
import { ModelBadge } from "./ModelBadge";
import { springs } from "@/lib/design-tokens";
import type { Agent } from "@/stores/agent-store";

/* ─── Types ─── */

type CardPhase = "active" | "completing";

type FloatingCard = {
  agent: Agent;
  phase: CardPhase;
};

/* ─── Completion tick overlay ─── */

function CompletionTick({ size }: { size: number }) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.1 }}
    >
      <div
        className="rounded-full bg-green-500 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size * 0.45}
          height={size * 0.45}
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <motion.path
            d="M5 13l4 4L19 7"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
          />
        </svg>
      </div>
    </motion.div>
  );
}

/* ─── Working pulse ring ─── */

function WorkingPulse() {
  return (
    <motion.div
      className="absolute inset-[-3px] rounded-full border-2 border-accent-primary"
      initial={{ opacity: 0.6, scale: 1 }}
      animate={{
        opacity: [0.6, 0.15, 0.6],
        scale: [1, 1.12, 1],
      }}
      transition={{
        duration: 1.8,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

/* ─── Single floating agent card ─── */

function AgentCard({ agentId, fallbackAgent, phase }: { agentId: string; fallbackAgent: Agent; phase: CardPhase }) {
  // Always read the latest agent data from the store so avatar updates are reflected
  const registeredAgent = useAgentStore((s) =>
    s.agents.find((a) => a.registryId === agentId)
  );
  const agent = registeredAgent || fallbackAgent;

  const borderColor =
    agent.model === "opus"
      ? "border-agent-opus"
      : agent.model === "sonnet"
      ? "border-agent-sonnet"
      : "border-agent-haiku";

  const avatarSize = 72;

  return (
    <div
      className={`
        relative flex flex-col items-center gap-3 bg-bg-tertiary rounded-[2px]
        border-2 ${borderColor} w-[200px] px-6 py-6
        shadow-[0_12px_48px_rgba(0,0,0,0.6)]
      `}
    >
      {/* Avatar with overlays */}
      <div className="relative" style={{ width: avatarSize, height: avatarSize }}>
        <AgentAvatar
          src={agent.avatar || undefined}
          name={agent.name}
          size={avatarSize}
          modelTier={agent.model}
        />

        {/* Working pulse ring */}
        {phase === "active" && <WorkingPulse />}

        {/* Completion tick overlay */}
        <AnimatePresence>
          {phase === "completing" && <CompletionTick size={avatarSize} />}
        </AnimatePresence>
      </div>

      {/* Name & role */}
      <div className="text-center">
        <p className="text-base font-bold text-text-primary leading-tight">
          {agent.name}
        </p>
        <p className="text-[13px] text-text-secondary leading-snug mt-0.5 line-clamp-2">
          {agent.role}
        </p>
      </div>

      {/* Status label */}
      <div className="flex items-center gap-1.5">
        {phase === "active" && (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span className="text-[10px] text-accent-primary font-semibold uppercase tracking-wider">
              Working
            </span>
          </>
        )}
        {phase === "completing" && (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-green-500 font-semibold uppercase tracking-wider">
              Complete
            </span>
          </>
        )}
      </div>

      <ModelBadge model={agent.model} />
    </div>
  );
}

/* ─── Main overlay — renders floating cards for active/completing agents ─── */

export function ActiveAgentOverlay() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgentIds = useAgentStore((s) => s.activeAgentIds);
  const activeAgentMeta = useAgentStore((s) => s.activeAgentMeta);

  const [cards, setCards] = useState<Record<string, FloatingCard>>({});
  const prevActiveIds = useRef<string[]>([]);
  const completionTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Detect changes in activeAgentIds
  useEffect(() => {
    const prev = new Set(prevActiveIds.current);
    const curr = new Set(activeAgentIds);

    // New agents started
    curr.forEach((id) => {
      if (!prev.has(id)) {
        // Build agent data from registry or metadata fallback
        const registered = agents.find((a) => a.registryId === id);
        const meta = activeAgentMeta[id];
        const agent: Agent = registered || {
          registryId: id,
          name: meta?.name || id,
          role: meta?.role || "Subagent",
          model: meta?.model || "sonnet",
          avatar: meta?.avatar || "",
          status: "active",
          tools: [],
          skills: [],
        };

        // Clear any existing completion timer (agent restarted)
        if (completionTimers.current[id]) {
          clearTimeout(completionTimers.current[id]);
          delete completionTimers.current[id];
        }

        setCards((c) => ({
          ...c,
          [id]: { agent, phase: "active" },
        }));
      }
    });

    // Agents stopped — transition to completing phase
    prev.forEach((id) => {
      if (!curr.has(id)) {
        setCards((c) => {
          if (!c[id]) return c;
          return {
            ...c,
            [id]: { ...c[id], phase: "completing" },
          };
        });

        // After completion animation plays, remove the card (triggers exit animation)
        completionTimers.current[id] = setTimeout(() => {
          setCards((c) => {
            const next = { ...c };
            delete next[id];
            return next;
          });
          delete completionTimers.current[id];
        }, 2000);
      }
    });

    prevActiveIds.current = [...activeAgentIds];
  }, [activeAgentIds, agents, activeAgentMeta]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = completionTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const cardEntries = Object.entries(cards);
  const hasCards = cardEntries.length > 0;

  return (
    <AnimatePresence>
      {hasCards && (
        <motion.div
          key="agent-overlay-backdrop"
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop scrim */}
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />

          {/* Cards container */}
          <div className="relative flex flex-col items-center gap-4 pointer-events-none">
            <AnimatePresence>
              {cardEntries.map(([id, { agent, phase }]) => (
                <motion.div
                  key={id}
                  initial={{ x: 300, opacity: 0, scale: 0.9 }}
                  animate={{ x: 0, opacity: 1, scale: 1 }}
                  exit={{ x: 300, opacity: 0, scale: 0.9 }}
                  transition={springs.snappy}
                  className="pointer-events-auto"
                >
                  <AgentCard agentId={id} fallbackAgent={agent} phase={phase} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
