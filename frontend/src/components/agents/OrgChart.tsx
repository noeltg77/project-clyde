"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAgentStore } from "@/stores/agent-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { AgentAvatar } from "./AgentAvatar";
import { PlatformLogo } from "./PlatformLogo";
import { ModelBadge } from "./ModelBadge";
import { TeamBadge } from "./TeamBadge";
import { DynamicIcon, TeamIconPicker } from "./TeamIconPicker";
import type { Agent, Team } from "@/stores/agent-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/* ─── Connector colours by model tier ─── */
const connectorColor: Record<string, string> = {
  opus: "#C8FF00",
  sonnet: "#00D4AA",
  haiku: "#A0A090",
  "gemini-pro": "#4285F4",
  "gemini-flash": "#FBBC04",
  "gemini-lite": "#34A853",
  "gpt-5.4": "#10A37F",
  "gpt-5.4-mini": "#10A37F",
  "gpt-5.4-nano": "#10A37F",
};

/* ─── SVG connector lines between nodes ─── */
function ConnectorLines({
  parentRef,
  childRefs,
  containerRef,
  childIds,
  colorFn,
  trunkColor = "#C8FF00",
}: {
  parentRef: React.RefObject<HTMLElement | null>;
  childRefs: React.RefObject<Map<string, HTMLElement>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  childIds: string[];
  colorFn: (id: string) => string;
  trunkColor?: string;
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
      childIds.forEach((id) => {
        const el = childRefs.current?.get(id);
        if (!el) return;
        const aRect = el.getBoundingClientRect();
        const ax = aRect.left + aRect.width / 2 - cRect.left;
        const ay = aRect.top - cRect.top;
        newLines.push({
          x1: px,
          y1: py,
          x2: ax,
          y2: ay,
          color: colorFn(id),
        });
      });
      setLines(newLines);
    }
    calc();
    window.addEventListener("resize", calc);
    const timeout = setTimeout(calc, 200);
    return () => {
      window.removeEventListener("resize", calc);
      clearTimeout(timeout);
    };
  }, [parentRef, childRefs, containerRef, childIds, colorFn]);

  if (lines.length === 0) return null;

  const midY = (lines[0].y1 + lines[0].y2) / 2;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      <line
        x1={lines[0]?.x1}
        y1={lines[0]?.y1}
        x2={lines[0]?.x1}
        y2={midY}
        stroke={trunkColor}
        strokeWidth="2"
      />
      <circle cx={lines[0]?.x1} cy={midY} r="3" fill={trunkColor} />

      {lines.length > 1 && (
        <line
          x1={Math.min(...lines.map((l) => l.x2))}
          y1={midY}
          x2={Math.max(...lines.map((l) => l.x2))}
          y2={midY}
          stroke={trunkColor}
          strokeWidth="2"
        />
      )}

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
  team,
  teamBorderColor,
}: {
  agent: Agent;
  isOrchestrator?: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  onSelect: (agent: Agent) => void;
  nodeRef?: (el: HTMLElement | null) => void;
  team?: Team | null;
  teamBorderColor?: string;
}) {
  const modelBorderMap: Record<string, string> = {
    opus: "border-agent-opus",
    sonnet: "border-agent-sonnet",
    haiku: "border-agent-haiku",
    "gemini-pro": "border-[#4285F4]",
    "gemini-flash": "border-[#FBBC04]",
    "gemini-lite": "border-[#34A853]",
    "gpt-5.4": "border-[#10A37F]",
    "gpt-5.4-mini": "border-[#10A37F]",
    "gpt-5.4-nano": "border-[#10A37F]",
  };
  const borderColor = isOrchestrator
    ? "border-agent-opus"
    : modelBorderMap[agent.model] || "border-agent-opus";

  const avatarSize = 72;

  return (
    <button
      ref={nodeRef}
      onClick={() => onSelect(agent)}
      className={`
        relative flex flex-col items-center justify-between gap-2 bg-bg-tertiary rounded-[2px]
        border-2 transition-all hover:brightness-110 cursor-pointer
        w-[200px] min-h-[250px] px-6 py-5
        ${teamBorderColor ? "" : isSelected ? `${borderColor} ring-2 ring-accent-primary/20` : borderColor}
        ${isSelected && teamBorderColor ? "ring-2 ring-accent-primary/20" : ""}
      `}
      style={{ zIndex: 1, ...(teamBorderColor ? { borderColor: teamBorderColor } : {}) }}
    >
      {/* Platform logo — top-right */}
      <div className="absolute top-3 right-3">
        <PlatformLogo platform={agent.platform || "claude"} size={16} />
      </div>

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

      <div className="flex flex-col items-center gap-1.5">
        <ModelBadge model={agent.model} />
        {team && <TeamBadge name={team.name} color={team.color} />}
      </div>
    </button>
  );
}

/* ─── Team Group Card (for team overview) ─── */
function TeamGroupCard({
  team,
  memberCount,
  onClick,
  nodeRef,
}: {
  team: Team;
  memberCount: number;
  onClick: () => void;
  nodeRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={nodeRef}
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-3 bg-bg-tertiary rounded-[2px] border-2 transition-all hover:brightness-110 cursor-pointer w-[200px] h-[160px] px-6 py-4"
      style={{ borderColor: team.color, zIndex: 1 }}
    >
      <div
        className="w-8 h-8 rounded-[4px] flex items-center justify-center"
        style={{ backgroundColor: `${team.color}20` }}
      >
        <DynamicIcon name={team.icon || "Users"} size={18} color={team.color} />
      </div>
      <p className="font-bold text-text-primary text-base">{team.name}</p>
      <p className="text-text-secondary text-[12px]">
        {memberCount} {memberCount === 1 ? "agent" : "agents"}
      </p>
    </button>
  );
}

/* ─── HSV ↔ Hex helpers ─── */

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

function hsvToHex(h: number, s: number, v: number): string {
  const hh = h / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/* ─── Custom styled colour picker ─── */

function TeamColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingSV, setDraggingSV] = useState(false);
  const [draggingHue, setDraggingHue] = useState(false);

  const SV_W = 220, SV_H = 150, HUE_W = 220, HUE_H = 14;

  // Sync when external value changes
  useEffect(() => {
    setHsv(hexToHsv(value));
  }, [value]);

  // Draw saturation/value gradient
  const drawSV = useCallback((h: number) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // White → hue horizontal gradient
    const hGrad = ctx.createLinearGradient(0, 0, SV_W, 0);
    hGrad.addColorStop(0, "#FFFFFF");
    hGrad.addColorStop(1, hsvToHex(h, 1, 1));
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, 0, SV_W, SV_H);

    // Transparent → black vertical gradient
    const vGrad = ctx.createLinearGradient(0, 0, 0, SV_H);
    vGrad.addColorStop(0, "rgba(0,0,0,0)");
    vGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, SV_W, SV_H);
  }, []);

  // Draw hue bar
  const drawHue = useCallback(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, HUE_W, 0);
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i / 6, hsvToHex(i * 60, 1, 1));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, HUE_W, HUE_H);
  }, []);

  useEffect(() => {
    drawSV(hsv[0]);
    drawHue();
  }, [hsv[0], drawSV, drawHue]);

  const updateSV = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    const newHsv: [number, number, number] = [hsv[0], s, v];
    setHsv(newHsv);
    onChange(hsvToHex(newHsv[0], newHsv[1], newHsv[2]));
  }, [hsv, onChange]);

  const updateHue = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const h = Math.max(0, Math.min(359, ((e.clientX - rect.left) / rect.width) * 360));
    const newHsv: [number, number, number] = [h, hsv[1], hsv[2]];
    setHsv(newHsv);
    onChange(hsvToHex(newHsv[0], newHsv[1], newHsv[2]));
  }, [hsv, onChange]);

  // Global mouse listeners for dragging
  useEffect(() => {
    if (!draggingSV && !draggingHue) return;
    const handleMove = (e: MouseEvent) => {
      if (draggingSV) updateSV(e);
      if (draggingHue) updateHue(e);
    };
    const handleUp = () => {
      setDraggingSV(false);
      setDraggingHue(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingSV, draggingHue, updateSV, updateHue]);

  // Thumb positions
  const svThumbX = hsv[1] * SV_W;
  const svThumbY = (1 - hsv[2]) * SV_H;
  const hueThumbX = (hsv[0] / 360) * HUE_W;

  return (
    <div className="space-y-3">
      {/* Saturation / Value canvas */}
      <div className="relative" style={{ width: SV_W, height: SV_H }}>
        <canvas
          ref={svCanvasRef}
          width={SV_W}
          height={SV_H}
          className="rounded-[3px] cursor-crosshair block"
          onMouseDown={(e) => { setDraggingSV(true); updateSV(e); }}
        />
        {/* Thumb */}
        <div
          className="absolute pointer-events-none"
          style={{ left: svThumbX - 7, top: svThumbY - 7 }}
        >
          <div className="w-[14px] h-[14px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(0,0,0,0.2)]" />
        </div>
      </div>

      {/* Hue bar */}
      <div className="relative" style={{ width: HUE_W, height: HUE_H }}>
        <canvas
          ref={hueCanvasRef}
          width={HUE_W}
          height={HUE_H}
          className="rounded-full cursor-pointer block"
          onMouseDown={(e) => { setDraggingHue(true); updateHue(e); }}
        />
        {/* Hue thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: hueThumbX - 7 }}
        >
          <div className="w-[14px] h-[14px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
            style={{ backgroundColor: hsvToHex(hsv[0], 1, 1) }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Inline-editable Team Header ─── */
function TeamHeader({
  team,
  onBack,
  onRename,
  onColorChange,
  onIconChange,
}: {
  team: Team;
  onBack: () => void;
  onRename: (newName: string) => void;
  onColorChange: (newColor: string) => void;
  onIconChange: (newIcon: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(team.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [draftColor, setDraftColor] = useState(team.color);
  const [hexInput, setHexInput] = useState(team.color);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync draft colour when team changes
  useEffect(() => {
    setDraftColor(team.color);
    setHexInput(team.color);
  }, [team.color]);

  // Close picker on outside click
  useEffect(() => {
    if (!colorPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
        setDraftColor(team.color);
        setHexInput(team.color);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorPickerOpen, team.color]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== team.name) {
      onRename(trimmed);
    } else {
      setDraft(team.name);
    }
    setEditing(false);
  };

  const handleHexChange = (value: string) => {
    setHexInput(value);
    // Auto-apply if it looks like a valid hex colour
    const cleaned = value.startsWith("#") ? value : `#${value}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(cleaned)) {
      setDraftColor(cleaned);
    }
  };

  const saveColor = () => {
    onColorChange(draftColor);
    setColorPickerOpen(false);
  };

  return (
    <div className="flex items-center gap-3 mb-8 justify-center">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border bg-bg-tertiary text-text-secondary border-border hover:text-text-primary hover:border-text-secondary/40 transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* Icon — click to open icon picker */}
      <div className="relative">
        <button
          onClick={() => { setIconPickerOpen(!iconPickerOpen); setColorPickerOpen(false); }}
          className="w-8 h-8 rounded-[4px] flex items-center justify-center flex-shrink-0 border border-white/10 hover:border-white/30 transition-colors cursor-pointer"
          style={{ backgroundColor: `${team.color}20` }}
          title="Change team icon"
        >
          <DynamicIcon name={team.icon || "Users"} size={18} color={team.color} />
        </button>

        {iconPickerOpen && (
          <TeamIconPicker
            value={team.icon || "Users"}
            teamColor={team.color}
            onSelect={(iconName) => {
              onIconChange(iconName);
              setIconPickerOpen(false);
            }}
            onClose={() => setIconPickerOpen(false)}
          />
        )}
      </div>

      {/* Colour dot — click to open colour picker */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => { setColorPickerOpen(!colorPickerOpen); setIconPickerOpen(false); }}
          className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20 hover:border-white/50 transition-colors cursor-pointer"
          style={{ backgroundColor: team.color }}
          title="Change team colour"
        />

        {/* Colour picker popover */}
        {colorPickerOpen && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-bg-secondary border border-border rounded-[4px] p-4 shadow-xl"
            style={{ width: 252 }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50 mb-3">
              Team Colour
            </p>

            {/* Custom SV + Hue picker */}
            <TeamColorPicker
              value={draftColor}
              onChange={(hex) => {
                setDraftColor(hex);
                setHexInput(hex);
              }}
            />

            {/* Hex input */}
            <div className="mt-3 mb-3">
              <label className="text-[10px] text-text-secondary/40 block mb-1">Hex Code</label>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveColor();
                  if (e.key === "Escape") {
                    setColorPickerOpen(false);
                    setDraftColor(team.color);
                    setHexInput(team.color);
                  }
                }}
                placeholder="#FF6B6B"
                maxLength={7}
                className="w-full px-2 py-1.5 text-sm font-mono bg-bg-tertiary border border-border rounded-[2px] text-text-primary outline-none focus:border-accent-primary/50"
              />
            </div>

            {/* Preview + Save */}
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-[2px] border border-white/10 flex-shrink-0"
                style={{ backgroundColor: draftColor }}
              />
              <button
                onClick={saveColor}
                className="flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(team.name);
                setEditing(false);
              }
            }}
            className="text-xl font-bold text-text-primary bg-bg-secondary border border-accent-primary/30 rounded-[2px] px-2 py-0.5 outline-none font-display"
          />
          <button
            onClick={commit}
            className="p-1.5 rounded-[2px] text-accent-tertiary hover:bg-accent-tertiary/15 transition-colors"
            title="Save name"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </>
      ) : (
        <>
          <h2 className="text-xl font-bold text-text-primary font-display">
            {team.name}
          </h2>
          <button
            onClick={() => {
              setDraft(team.name);
              setEditing(true);
            }}
            className="p-1.5 rounded-[2px] text-text-secondary/40 hover:text-text-primary hover:bg-bg-secondary transition-colors"
            title="Rename team"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

/* ─── Agent Detail Panel ─── */
type AgentIntegration = {
  id: string;
  name: string;
  type: "api" | "webhook";
  base_url: string;
  method: string;
  auth_type: string;
  enabled: boolean;
  assigned_agents: string[];
};

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
  const [agentIntegrations, setAgentIntegrations] = useState<AgentIntegration[]>([]);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);

  const isOrchestrator = agent.registryId === "clyde-001";

  // Fetch integrations assigned to this agent
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/integrations`);
        const data = await res.json();
        if (cancelled) return;
        const all: AgentIntegration[] = data.integrations || [];
        const assigned = all.filter(
          (i) => Array.isArray(i.assigned_agents) && i.assigned_agents.includes(agent.registryId)
        );
        setAgentIntegrations(assigned);
      } catch {
        if (!cancelled) setAgentIntegrations([]);
      }
    })();
    return () => { cancelled = true; };
  }, [agent.registryId]);

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
        {agentIntegrations.length > 0 && (
          <div className="col-span-2">
            <span className="text-text-secondary/60 text-[11px] uppercase tracking-wider font-semibold">
              APIs / Webhooks
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agentIntegrations.map((integration) => (
                <span
                  key={integration.id}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono rounded-[2px] border ${
                    integration.type === "api"
                      ? "bg-accent-tertiary/10 text-accent-tertiary border-accent-tertiary/20"
                      : "bg-accent-secondary/10 text-accent-secondary border-accent-secondary/20"
                  } ${!integration.enabled ? "opacity-40" : ""}`}
                >
                  <span className={`w-1 h-1 rounded-full ${
                    integration.type === "api" ? "bg-accent-tertiary" : "bg-accent-secondary"
                  }`} />
                  {integration.name}
                  <span className={`text-[8px] uppercase font-semibold ${
                    integration.type === "api"
                      ? "text-accent-tertiary/50"
                      : "text-accent-secondary/50"
                  }`}>
                    {integration.type}
                  </span>
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
  const teams = useAgentStore((s) => s.teams);
  const activeAgentIds = useAgentStore((s) => s.activeAgentIds);
  const setAgents = useAgentStore((s) => s.setAgents);
  const setTeams = useAgentStore((s) => s.setTeams);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const updateTeamStore = useAgentStore((s) => s.updateTeam);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  // View mode: flat (all agents) or teams (grouped by team)
  const [viewMode, setViewMode] = useState<"flat" | "teams">("teams");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const childRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  // Team lookup map
  const teamMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  // Fetch agents and teams from API on mount
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
              platform?: string;
              model: string;
              avatar?: string;
              status: string;
              tools?: string[];
              skills?: string[];
              team?: string;
            }) => ({
              registryId: a.id,
              name: a.name,
              role: a.role,
              platform: (a.platform || "claude") as Agent["platform"],
              model: a.model as Agent["model"],
              avatar: a.avatar || "",
              status: a.status as Agent["status"],
              tools: a.tools || [],
              skills: a.skills || [],
              team: a.team || null,
            })
          );
          setAgents(parsed);

          // Parse teams
          const parsedTeams: Team[] = (data.teams || []).map(
            (t: { id: string; name: string; color: string; icon?: string; created_at?: string }) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              icon: t.icon || "Users",
              created_at: t.created_at || "",
            })
          );
          setTeams(parsedTeams);
        }
      } catch {
        // Will rely on WebSocket updates
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, [setAgents, setTeams]);

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

  // Handle team rename via REST
  const handleTeamRename = async (teamId: string, newName: string) => {
    try {
      const res = await fetch(`${API_URL}/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (res.ok) {
        updateTeamStore(teamId, { name: newName });
      }
    } catch (err) {
      console.error("Failed to rename team:", err);
    }
  };

  // Handle team colour change via REST
  const handleTeamColorChange = async (teamId: string, newColor: string) => {
    try {
      const res = await fetch(`${API_URL}/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: newColor }),
      });
      if (res.ok) {
        updateTeamStore(teamId, { color: newColor });
      }
    } catch (err) {
      console.error("Failed to update team colour:", err);
    }
  };

  // Handle team icon change via REST
  const handleTeamIconChange = async (teamId: string, newIcon: string) => {
    try {
      const res = await fetch(`${API_URL}/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: newIcon }),
      });
      if (res.ok) {
        updateTeamStore(teamId, { icon: newIcon });
      }
    } catch (err) {
      console.error("Failed to update team icon:", err);
    }
  };

  const activeAgents = agents.filter((a) => a.status === "active");
  const pausedAgents = agents.filter((a) => a.status === "paused");
  const archivedAgents = agents.filter((a) => a.status === "archived");

  // Agents grouped by team for team view
  const unassignedAgents = activeAgents.filter((a) => !a.team);
  const teamsWithMembers = useMemo(() => {
    return teams.map((t) => ({
      team: t,
      members: activeAgents.filter((a) => a.team === t.id),
    }));
  }, [teams, activeAgents]);

  // Selected team details
  const selectedTeam = selectedTeamId ? teamMap.get(selectedTeamId) : null;
  const selectedTeamMembers = selectedTeamId
    ? activeAgents.filter((a) => a.team === selectedTeamId)
    : [];

  // Color function for connector lines
  const agentColorFn = useMemo(
    () => (id: string) => {
      const agent = activeAgents.find((a) => a.registryId === id);
      return agent ? connectorColor[agent.model] || "#C8FF00" : "#C8FF00";
    },
    [activeAgents]
  );

  const teamColorFn = useMemo(
    () => (id: string) => {
      const team = teamMap.get(id);
      return team?.color || "#A0A090";
    },
    [teamMap]
  );

  const teamMemberColorFn = useMemo(
    () => (id: string) => {
      const agent = selectedTeamMembers.find((a) => a.registryId === id);
      return agent ? connectorColor[agent.model] || "#C8FF00" : "#C8FF00";
    },
    [selectedTeamMembers]
  );

  const orchestrator = useAgentStore((s) => s.orchestrator);
  const clydeAgent: Agent = orchestrator || {
    registryId: "clyde-001",
    name: "Clyde",
    role: "CEO",
    platform: "claude",
    model: "opus",
    avatar: "/avatars/clyde.jpeg",
    status: "active",
    tools: [],
    skills: [],
    team: null,
  };

  // Build child IDs arrays for connector lines
  const flatChildIds = activeAgents.map((a) => a.registryId);
  const teamChildIds = [
    ...teams.map((t) => t.id),
    ...(unassignedAgents.length > 0 ? ["__unassigned__"] : []),
  ];
  const teamMemberChildIds = selectedTeamMembers.map((a) => a.registryId);

  // Color fn for team overview (including unassigned)
  const teamOverviewColorFn = useMemo(
    () => (id: string) => {
      if (id === "__unassigned__") return "#A0A090";
      const team = teamMap.get(id);
      return team?.color || "#A0A090";
    },
    [teamMap]
  );

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
          {/* View toggle */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <button
              onClick={() => {
                setViewMode("flat");
                setSelectedTeamId(null);
                setSelectedAgent(null);
              }}
              className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border transition-colors ${
                viewMode === "flat"
                  ? "bg-accent-primary/15 text-accent-primary border-accent-primary/30"
                  : "bg-bg-tertiary text-text-secondary border-border hover:text-text-primary"
              }`}
            >
              All Agents
            </button>
            <button
              onClick={() => {
                setViewMode("teams");
                setSelectedTeamId(null);
                setSelectedAgent(null);
              }}
              className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border transition-colors ${
                viewMode === "teams"
                  ? "bg-accent-primary/15 text-accent-primary border-accent-primary/30"
                  : "bg-bg-tertiary text-text-secondary border-border hover:text-text-primary"
              }`}
            >
              Teams
            </button>
          </div>

          {/* ═══ FLAT VIEW ═══ */}
          {viewMode === "flat" && (
            <>
              <div ref={containerRef} className="relative max-w-6xl mx-auto">
                {activeAgents.length > 0 && (
                  <ConnectorLines
                    parentRef={parentRef}
                    childRefs={childRefsMap}
                    containerRef={containerRef}
                    childIds={flatChildIds}
                    colorFn={agentColorFn}
                    trunkColor={connectorColor[clydeAgent.model] || "#C8FF00"}
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
                        team={teamMap.get(agent.team || "")}
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
            </>
          )}

          {/* ═══ TEAMS VIEW ═══ */}
          {viewMode === "teams" && (
            <AnimatePresence mode="wait">
              {/* Team Overview (no team selected) */}
              {!selectedTeamId && (
                <motion.div
                  key="team-overview"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  transition={{ duration: 0.25 }}
                >
                  <div ref={containerRef} className="relative max-w-6xl mx-auto">
                    {(teams.length > 0 || unassignedAgents.length > 0) && (
                      <ConnectorLines
                        parentRef={parentRef}
                        childRefs={childRefsMap}
                        containerRef={containerRef}
                        childIds={teamChildIds}
                        colorFn={teamOverviewColorFn}
                        trunkColor={connectorColor[clydeAgent.model] || "#C8FF00"}
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

                    {/* Team group cards */}
                    <div className="flex flex-wrap justify-center gap-6">
                      {teamsWithMembers.map(({ team, members }) => (
                        <TeamGroupCard
                          key={team.id}
                          team={team}
                          memberCount={members.length}
                          onClick={() => {
                            setSelectedTeamId(team.id);
                            setSelectedAgent(null);
                          }}
                          nodeRef={(el) => {
                            if (el) {
                              childRefsMap.current.set(team.id, el);
                            } else {
                              childRefsMap.current.delete(team.id);
                            }
                          }}
                        />
                      ))}

                      {/* Unassigned group */}
                      {unassignedAgents.length > 0 && (
                        <button
                          ref={(el) => {
                            if (el) {
                              childRefsMap.current.set("__unassigned__", el);
                            } else {
                              childRefsMap.current.delete("__unassigned__");
                            }
                          }}
                          onClick={() => {
                            setSelectedTeamId("__unassigned__");
                            setSelectedAgent(null);
                          }}
                          className="relative flex flex-col items-center justify-center gap-3 bg-bg-tertiary rounded-[2px] border-2 border-border transition-all hover:brightness-110 cursor-pointer w-[200px] h-[160px] px-6 py-4"
                          style={{ zIndex: 1 }}
                        >
                          <div className="w-5 h-5 rounded-[2px] bg-text-secondary/30" />
                          <p className="font-bold text-text-secondary text-base">Unassigned</p>
                          <p className="text-text-secondary/60 text-[12px]">
                            {unassignedAgents.length} {unassignedAgents.length === 1 ? "agent" : "agents"}
                          </p>
                        </button>
                      )}
                    </div>

                    {teams.length === 0 && unassignedAgents.length === 0 && !loading && (
                      <div className="mt-2 text-center">
                        <p className="text-sm text-text-secondary/50">
                          No teams or agents yet
                        </p>
                        <p className="text-[11px] text-text-secondary/30 mt-1">
                          Ask Clyde to create a team
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Selected Agent Detail (from clicking Clyde) */}
                  {selectedAgent && (
                    <div className="max-w-3xl mx-auto mt-10">
                      <AgentDetail
                        agent={selectedAgent}
                        onClose={() => setSelectedAgent(null)}
                        onStatusChange={handleStatusChange}
                      />
                    </div>
                  )}
                </motion.div>
              )}

              {/* Team Detail (zoomed in) */}
              {selectedTeamId && (
                <motion.div
                  key={`team-detail-${selectedTeamId}`}
                  initial={{ opacity: 0, scale: 1.1 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25 }}
                >
                  {/* Team header with back button and editable name */}
                  {selectedTeamId === "__unassigned__" ? (
                    <div className="flex items-center gap-3 mb-8 justify-center">
                      <button
                        onClick={() => {
                          setSelectedTeamId(null);
                          setSelectedAgent(null);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border bg-bg-tertiary text-text-secondary border-border hover:text-text-primary hover:border-text-secondary/40 transition-colors"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                        Back
                      </button>
                      <div className="w-4 h-4 rounded-[2px] bg-text-secondary/30" />
                      <h2 className="text-xl font-bold text-text-secondary font-display">
                        Unassigned
                      </h2>
                    </div>
                  ) : (
                    selectedTeam && (
                      <TeamHeader
                        team={selectedTeam}
                        onBack={() => {
                          setSelectedTeamId(null);
                          setSelectedAgent(null);
                        }}
                        onRename={(newName) => handleTeamRename(selectedTeamId, newName)}
                        onColorChange={(newColor) => handleTeamColorChange(selectedTeamId, newColor)}
                        onIconChange={(newIcon) => handleTeamIconChange(selectedTeamId, newIcon)}
                      />
                    )
                  )}

                  {/* Team members */}
                  <div ref={containerRef} className="relative max-w-6xl mx-auto">
                    {(selectedTeamId === "__unassigned__" ? unassignedAgents : selectedTeamMembers).length > 0 && (
                      <ConnectorLines
                        parentRef={parentRef}
                        childRefs={childRefsMap}
                        containerRef={containerRef}
                        childIds={
                          selectedTeamId === "__unassigned__"
                            ? unassignedAgents.map((a) => a.registryId)
                            : teamMemberChildIds
                        }
                        colorFn={
                          selectedTeamId === "__unassigned__"
                            ? agentColorFn
                            : teamMemberColorFn
                        }
                        trunkColor={selectedTeam?.color || "#A0A090"}
                      />
                    )}

                    {/* Clyde as parent node */}
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

                    {/* Member cards */}
                    <div className="flex flex-wrap justify-center gap-6">
                      {(selectedTeamId === "__unassigned__" ? unassignedAgents : selectedTeamMembers).map(
                        (agent) => (
                          <AgentNode
                            key={agent.registryId}
                            agent={agent}
                            isActive={activeAgentIds.includes(agent.registryId)}
                            isSelected={selectedAgent?.registryId === agent.registryId}
                            onSelect={setSelectedAgent}
                            team={teamMap.get(agent.team || "")}
                            teamBorderColor={selectedTeam?.color}
                            nodeRef={(el) => {
                              if (el) {
                                childRefsMap.current.set(agent.registryId, el);
                              } else {
                                childRefsMap.current.delete(agent.registryId);
                              }
                            }}
                          />
                        )
                      )}
                    </div>

                    {(selectedTeamId === "__unassigned__" ? unassignedAgents : selectedTeamMembers).length === 0 && (
                      <div className="mt-2 text-center">
                        <p className="text-sm text-text-secondary/50">
                          No agents in this {selectedTeamId === "__unassigned__" ? "group" : "team"}
                        </p>
                        <p className="text-[11px] text-text-secondary/30 mt-1">
                          Ask Clyde to assign agents
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
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
