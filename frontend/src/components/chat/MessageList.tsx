"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useChatStore } from "@/stores/chat-store-provider";
import { useAgentStore } from "@/stores/agent-store-provider";
import { MessageBubble } from "./MessageBubble";
import { AgentActivityBubble } from "./AgentActivityBubble";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { HeroCarousel } from "@/components/layout/HeroCarousel";

/* ─── Thinking indicator — shown while waiting for Clyde's first chunk ─── */
function ThinkingIndicator() {
  const orchestrator = useAgentStore((s) => s.orchestrator);
  const clydeModel = orchestrator?.model || "opus";
  const letters = "Thinking".split("");

  return (
    <div className="flex gap-3 mb-4">
      <AgentAvatar
        src={orchestrator?.avatar || "/avatars/clyde.jpeg"}
        name="Clyde"
        size={40}
        modelTier={clydeModel}
      />
      <div className="flex-1 max-w-[80%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-text-primary">Clyde</span>
        </div>
        <div className={`bg-bg-secondary border-l-2 rounded-[2px] px-4 py-3 ${
          clydeModel === "opus"
            ? "border-accent-primary"
            : clydeModel === "sonnet"
            ? "border-accent-secondary"
            : "border-text-secondary/30"
        }`}>
          <span className="inline-flex" aria-label="Thinking">
            {letters.map((char, i) => (
              <motion.span
                key={i}
                className="text-sm text-text-secondary font-mono"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.08,
                }}
              >
                {char}
              </motion.span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div
            className={`w-8 h-8 rounded-full flex-shrink-0 ${
              i % 2 === 1 ? "bg-bg-tertiary" : "bg-accent-primary/10"
            }`}
          />
          <div className="flex-1 space-y-2">
            <div
              className={`h-3 rounded-[2px] ${
                i % 2 === 1 ? "bg-bg-tertiary w-16" : "bg-accent-primary/10 w-12"
              }`}
            />
            <div className="h-3 bg-bg-tertiary rounded-[2px] w-full" />
            <div
              className={`h-3 bg-bg-tertiary rounded-[2px] ${
                i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-5/6" : "w-2/3"
              }`}
            />
            {i % 2 === 0 && (
              <div className="h-3 bg-bg-tertiary rounded-[2px] w-1/2" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isLoadingSession = useChatStore((s) => s.isLoadingSession);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Show thinking when streaming but Clyde hasn't started replying yet
  const lastMsg = messages[messages.length - 1];
  const showThinking = isStreaming && lastMsg?.role === "user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showThinking]);

  if (isLoadingSession) {
    return <LoadingSkeleton />;
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 p-6">
          <HeroCarousel />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {messages.map((msg) =>
        msg.activityStatus ? (
          <AgentActivityBubble key={msg.id} message={msg} />
        ) : (
          <MessageBubble key={msg.id} message={msg} />
        )
      )}
      {showThinking && <ThinkingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
