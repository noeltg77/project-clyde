"use client";

import { useChatStore } from "@/stores/chat-store-provider";
import { useAgentStore } from "@/stores/agent-store-provider";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { ModelBadge } from "@/components/agents/ModelBadge";

export function ActivityPanel() {
  const isConnected = useChatStore((s) => s.isConnected);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);

  const agents = useAgentStore((s) => s.agents);
  const activeAgentIds = useAgentStore((s) => s.activeAgentIds);
  // Calculate session cost from messages
  const sessionCostUsd = messages.reduce(
    (total, msg) => total + (msg.costUsd || 0),
    0
  );

  return (
    <aside className="w-72 bg-bg-secondary border-l-2 border-border flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
          Team
        </h2>
      </div>

      {/* Agent Roster */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Clyde — always first */}
        <div className="flex items-center gap-3 p-2 bg-bg-tertiary rounded-[2px]">
          <AgentAvatar
            src="/avatars/clyde.jpeg"
            name="Clyde"
            size={32}
            modelTier="opus"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">
              Clyde
            </p>
            <div className="flex items-center gap-1.5">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  isStreaming
                    ? "bg-accent-primary animate-pulse"
                    : isConnected
                    ? "bg-accent-tertiary"
                    : "bg-error"
                }`}
              />
              <span className="text-[11px] text-text-secondary">
                {isStreaming
                  ? "Working..."
                  : isConnected
                  ? "Online"
                  : "Offline"}
              </span>
            </div>
          </div>
          <ModelBadge model="opus" />
        </div>

        {/* Subagents */}
        {agents
          .filter((a) => a.status === "active")
          .map((agent) => {
            const isActive = activeAgentIds.includes(agent.registryId);
            return (
              <div
                key={agent.registryId}
                className="flex items-center gap-3 p-2 bg-bg-tertiary rounded-[2px]"
              >
                <AgentAvatar
                  src={agent.avatar || undefined}
                  name={agent.name}
                  size={32}
                  modelTier={agent.model}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {agent.name}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        isActive
                          ? "bg-accent-primary animate-pulse"
                          : "bg-text-secondary/30"
                      }`}
                    />
                    <span className="text-[11px] text-text-secondary truncate">
                      {isActive ? "Working..." : agent.role}
                    </span>
                  </div>
                </div>
                <ModelBadge model={agent.model} />
              </div>
            );
          })}

        {/* Paused agents */}
        {agents
          .filter((a) => a.status === "paused")
          .map((agent) => (
            <div
              key={agent.registryId}
              className="flex items-center gap-3 p-2 bg-bg-tertiary/50 rounded-[2px] opacity-60"
            >
              <AgentAvatar
                src={agent.avatar || undefined}
                name={agent.name}
                size={32}
                modelTier={agent.model}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {agent.name}
                </p>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  <span className="text-[11px] text-text-secondary truncate">
                    Paused
                  </span>
                </div>
              </div>
              <ModelBadge model={agent.model} />
            </div>
          ))}

        {agents.filter((a) => a.status !== "archived").length === 0 && (
          <p className="text-[11px] text-text-secondary/50 text-center py-2">
            No subagents yet
          </p>
        )}
      </div>

      {/* Session Cost */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-secondary uppercase tracking-wider">
            Session
          </span>
          <span className="text-sm font-mono text-accent-primary">
            ${sessionCostUsd.toFixed(4)}
          </span>
        </div>
      </div>
    </aside>
  );
}
