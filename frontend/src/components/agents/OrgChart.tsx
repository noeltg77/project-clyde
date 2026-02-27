"use client";

import { useEffect, useState, useRef } from "react";
import { useAgentStore } from "@/stores/agent-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { AgentAvatar } from "./AgentAvatar";
import { ModelBadge } from "./ModelBadge";
import type { Agent } from "@/stores/agent-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/* ─── Connector colours by model tier ─── */
const connectorColor: Record<string, string> = {
  opus: "#C8FF00",
  sonnet: "#00D4AA",
  haiku: "#A0A090",
};

/* ─── SVG connector lines between nodes ─── */
function ConnectorLines({
  parentRef,
  childRefs,
  containerRef,
  agents,
}: {
  parentRef: React.RefObject<HTMLElement | null>;
  childRefs: React.RefObject<Map<string, HTMLElement>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  agents: Agent[];
}) {
  const [lines, setLines] = useState<
    { x1: number; y1: number; x2: number; y2: number; color: string }[]
  >([]);

  useEffect(() => {
    function calc() {
      if (!parentRef.current || !containerRef.current || !childRefs.current) return;
      const cRect = containerRef.current.getBoundingClientRect();
      const pRect = parentRef.current.getBoundingClientRect();
      const px = pRect.left + pRect.width / 2 - cRect.left;
      const py = pRect.bottom - cRect.top;

      const newLines: typeof lines = [];
      agents.forEach((agent) => {
        const el = childRefs.current?.get(agent.registryId);
        if (!el) return;
        const aRect = el.getBoundingClientRect();
        const ax = aRect.left + aRect.width / 2 - cRect.left;
        const ay = aRect.top - cRect.top;
        newLines.push({
          x1: px,
          y1: py,
          x2: ax,
          y2: ay,
          color: connectorColor[agent.model] || "#C8FF00",
        });
      });
      setLines(newLines);
    }
    calc();
    window.addEventListener("resize", calc);
    // Recalc after images potentially load
    const timeout = setTimeout(calc, 200);
    return () => {
      window.removeEventListener("resize", calc);
      clearTimeout(timeout);
    };
  }, [parentRef, childRefs, containerRef, agents]);

  if (lines.length === 0) return null;

  // Find the mid-Y between parent bottom and child tops
  const midY = lines.length > 0
    ? (lines[0].y1 + lines[0].y2) / 2
    : 0;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      {/* Vertical line from parent down to midY */}
      <line
        x1={lines[0]?.x1}
        y1={lines[0]?.y1}
        x2={lines[0]?.x1}
        y2={midY}
        stroke={connectorColor.opus}
        strokeWidth="2"
      />
      {/* Junction dot at parent */}
      <circle cx={lines[0]?.x1} cy={midY} r="3" fill={connectorColor.opus} />

      {/* Horizontal line spanning all children */}
      {lines.length > 1 && (
        <line
          x1={Math.min(...lines.map((l) => l.x2))}
          y1={midY}
          x2={Math.max(...lines.map((l) => l.x2))}
          y2={midY}
          stroke={connectorColor.opus}
          strokeWidth="2"
        />
      )}

      {/* Vertical lines from midY down to each child */}
      {lines.map((line, i) => (
        <g key={i}>
          <line
            x1={line.x2}
            y1={midY}
            x2={line.x2}
            y2={line.y2}
            stroke={line.color}
            strokeWidth="2"
          />
          {/* Junction dots at horizontal line */}
          <rect
            x={line.x2 - 3}
            y={midY - 3}
            width="6"
            height="6"
            fill={line.color}
          />
        </g>
      ))}
    </svg>
  );
}

/* ─── Agent Card ─── */
function AgentNode({
  agent,
  isOrchestrator = false,
  isActive = false,
  isSelected = false,
  onSelect,
  nodeRef,
}: {
  agent: Agent;
  isOrchestrator?: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  onSelect: (agent: Agent) => void;
  nodeRef?: (el: HTMLElement | null) => void;
}) {
  const borderColor = isOrchestrator
    ? "border-agent-opus"
    : agent.model === "sonnet"
    ? "border-agent-sonnet"
    : agent.model === "haiku"
    ? "border-agent-haiku"
    : "border-agent-opus";

  const statusDotColor =
    agent.status === "active"
      ? isActive
        ? "bg-accent-primary"
        : "bg-accent-tertiary"
      : agent.status === "paused"
      ? "bg-yellow-500"
      : "bg-text-secondary/30";

  const avatarSize = 72;

  return (
    <button
      ref={nodeRef}
      onClick={() => onSelect(agent)}
      className={`
        relative flex flex-col items-center justify-between gap-3 bg-bg-tertiary rounded-[2px]
        border-2 transition-all hover:brightness-110 cursor-pointer
        w-[200px] h-[250px] px-6 py-6
        ${isSelected ? `${borderColor} ring-2 ring-accent-primary/20` : borderColor}
      `}
      style={{ zIndex: 1 }}
    >
      {/* Status indicator — top-right square dot */}
      <div
        className={`absolute top-3 right-3 w-2 h-2 rounded-[1px] ${statusDotColor}`}
      />

      <AgentAvatar
        src={agent.avatar || undefined}
        name={agent.name}
        size={avatarSize}
        modelTier={agent.model}
      />

      <div className="text-center flex-1 flex flex-col justify-center min-h-0">
        <p className={`font-bold text-text-primary ${isOrchestrator ? "text-lg" : "text-base"} leading-tight`}>
          {agent.name}
        </p>
        <p className={`text-text-secondary mt-0.5 ${isOrchestrator ? "text-sm" : "text-[13px]"} leading-snug line-clamp-2`}>
          {agent.role}
        </p>
      </div>

      <ModelBadge model={agent.model} />
    </button>
  );
}

/* ─── Agent Detail Panel ─── */
function AgentDetail({
  agent,
  onClose,
  onStatusChange,
}: {
  agent: Agent;
  onClose: () => void;
  onStatusChange: (registryId: string, newStatus: string) => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);

  const isOrchestrator = agent.registryId === "clyde-001";

  return (
    <div className="p-5 bg-bg-tertiary rounded-[2px] border border-border">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-semibold text-text-primary font-display">
          {agent.name}
        </h4>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">Role</span>
          <p className="text-text-primary mt-0.5">{agent.role}</p>
        </div>
        <div>
          <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">Model</span>
          <p className="text-text-primary mt-0.5">{agent.model}</p>
        </div>
        <div>
          <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">Status</span>
          <p className={`mt-0.5 ${
            agent.status === "active"
              ? "text-accent-tertiary"
              : agent.status === "paused"
              ? "text-yellow-500"
              : "text-text-secondary/50"
          }`}>
            {agent.status}
          </p>
        </div>
        <div>
          <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">ID</span>
          <p className="text-text-secondary font-mono text-[11px] mt-0.5">{agent.registryId}</p>
        </div>
        {agent.tools.length > 0 && (
          <div className="col-span-2">
            <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">Tools</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {agent.tools.map((tool) => (
                <span key={tool} className="px-1.5 py-0.5 text-[10px] font-mono bg-bg-secondary rounded-[2px] text-text-secondary border border-border">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
        {agent.skills.length > 0 && (
          <div className="col-span-2">
            <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">Skills</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {agent.skills.map((skill) => (
                <span key={skill} className="px-1.5 py-0.5 text-[10px] font-mono bg-accent-primary/10 rounded-[2px] text-accent-primary">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status actions — not shown for Clyde */}
      {!isOrchestrator && (
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
          {agent.status === "active" && (
            <button
              onClick={() => onStatusChange(agent.registryId, "paused")}
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-yellow-500/15 text-yellow-500 rounded-[2px] hover:bg-yellow-500/25 transition-colors"
            >
              Pause
            </button>
          )}
          {agent.status === "paused" && (
            <button
              onClick={() => onStatusChange(agent.registryId, "active")}
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-tertiary/15 text-accent-tertiary rounded-[2px] hover:bg-accent-tertiary/25 transition-colors"
            >
              Resume
            </button>
          )}
          {agent.status !== "archived" && !confirmArchive && (
            <button
              onClick={() => setConfirmArchive(true)}
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-error/15 text-error rounded-[2px] hover:bg-error/25 transition-colors"
            >
              Archive
            </button>
          )}
          {confirmArchive && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-error">Confirm?</span>
              <button
                onClick={() => {
                  onStatusChange(agent.registryId, "archived");
                  setConfirmArchive(false);
                }}
                className="px-2.5 py-1 text-[10px] font-semibold bg-error text-white rounded-[2px] hover:brightness-110 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmArchive(false)}
                className="px-2.5 py-1 text-[10px] font-semibold bg-bg-secondary text-text-secondary rounded-[2px] hover:text-text-primary transition-colors"
              >
                No
              </button>
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-bg-secondary text-text-secondary border border-border rounded-[2px] hover:text-accent-primary hover:border-accent-primary/30 transition-colors ml-auto"
          >
            View Prompt
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main OrgChart ─── */
export function OrgChart() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgentIds = useAgentStore((s) => s.activeAgentIds);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const childRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  // Fetch agents from API on mount
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch(`${API_URL}/api/agents`);
        if (res.ok) {
          const data = await res.json();
          const parsed: Agent[] = (data.agents || []).map(
            (a: {
              id: string;
              name: string;
              role: string;
              model: string;
              avatar?: string;
              status: string;
              tools?: string[];
              skills?: string[];
            }) => ({
              registryId: a.id,
              name: a.name,
              role: a.role,
              model: a.model as Agent["model"],
              avatar: a.avatar || "",
              status: a.status as Agent["status"],
              tools: a.tools || [],
              skills: a.skills || [],
            })
          );
          setAgents(parsed);
        }
      } catch {
        // Will rely on WebSocket updates
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, [setAgents]);

  // Handle status change via REST
  const handleStatusChange = async (registryId: string, newStatus: string) => {
    try {
      const res = await fetch(`${API_URL}/api/agents/${registryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        updateAgent(registryId, { status: newStatus as Agent["status"] });
        setSelectedAgent((prev) =>
          prev && prev.registryId === registryId
            ? { ...prev, status: newStatus as Agent["status"] }
            : prev
        );
      }
    } catch (err) {
      console.error("Failed to update agent status:", err);
    }
  };

  const activeAgents = agents.filter((a) => a.status === "active");
  const pausedAgents = agents.filter((a) => a.status === "paused");
  const archivedAgents = agents.filter((a) => a.status === "archived");

  const clydeAgent: Agent = {
    registryId: "clyde-001",
    name: "Clyde",
    role: "CEO",
    model: "opus",
    avatar: "/avatars/clyde.jpeg",
    status: "active",
    tools: [],
    skills: [],
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Grid background */}
        <div
          className="min-h-full p-8"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
          {/* Tree container — relative for SVG overlay */}
          <div ref={containerRef} className="relative max-w-6xl mx-auto">
            {/* SVG connector lines */}
            {activeAgents.length > 0 && (
              <ConnectorLines
                parentRef={parentRef}
                childRefs={childRefsMap}
                containerRef={containerRef}
                agents={activeAgents}
              />
            )}

            {/* Orchestrator — Clyde */}
            <div className="flex justify-center mb-16">
              <AgentNode
                agent={clydeAgent}
                isOrchestrator
                isActive
                isSelected={selectedAgent?.registryId === "clyde-001"}
                onSelect={setSelectedAgent}
                nodeRef={(el) => {
                  parentRef.current = el;
                }}
              />
            </div>

            {/* Subagents row */}
            {activeAgents.length > 0 && (
              <div className="flex flex-wrap justify-center gap-6">
                {activeAgents.map((agent) => (
                  <AgentNode
                    key={agent.registryId}
                    agent={agent}
                    isActive={activeAgentIds.includes(agent.registryId)}
                    isSelected={selectedAgent?.registryId === agent.registryId}
                    onSelect={setSelectedAgent}
                    nodeRef={(el) => {
                      if (el) {
                        childRefsMap.current.set(agent.registryId, el);
                      } else {
                        childRefsMap.current.delete(agent.registryId);
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {activeAgents.length === 0 && !loading && (
              <div className="mt-2 text-center">
                <p className="text-sm text-text-secondary/50">
                  No subagents created yet
                </p>
                <p className="text-[11px] text-text-secondary/30 mt-1">
                  Ask Clyde to create a specialist
                </p>
              </div>
            )}
          </div>

          {/* Selected Agent Detail */}
          {selectedAgent && (
            <div className="max-w-3xl mx-auto mt-10">
              <AgentDetail
                agent={selectedAgent}
                onClose={() => setSelectedAgent(null)}
                onStatusChange={handleStatusChange}
              />
            </div>
          )}

          {/* Paused + Archived sections */}
          {(pausedAgents.length > 0 || archivedAgents.length > 0) && (
            <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
              {pausedAgents.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-yellow-500/60 mb-3">
                    Paused
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {pausedAgents.map((agent) => (
                      <button
                        key={agent.registryId}
                        onClick={() => setSelectedAgent(agent)}
                        className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-[2px] border border-yellow-500/20 hover:border-yellow-500/40 transition-colors"
                      >
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <span className="text-sm text-text-secondary">
                          {agent.name}
                        </span>
                        <span className="text-[10px] text-text-secondary/40">
                          {agent.role}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {archivedAgents.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary/50 mb-3">
                    Archived
                  </h4>
                  <div className="space-y-1.5">
                    {archivedAgents.map((agent) => (
                      <button
                        key={agent.registryId}
                        onClick={() => setSelectedAgent(agent)}
                        className="flex items-center gap-2 px-3 py-1.5 text-text-secondary/50 hover:text-text-secondary transition-colors w-full text-left"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-text-secondary/20" />
                        <span className="text-sm">
                          {agent.name} — {agent.role}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
