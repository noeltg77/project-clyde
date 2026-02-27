"use client";

import { useCallback, useEffect, useState } from "react";
import { useChatStore } from "@/stores/chat-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { useInsightStore } from "@/stores/insight-store-provider";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Detect session origin from title prefix and return dot colour */
function sessionIndicator(title: string): { color: string; tooltip: string } | null {
  if (title.startsWith("[Scheduled]")) return { color: "bg-purple-500", tooltip: "Scheduled" };
  if (title.startsWith("[Trigger]"))   return { color: "bg-orange-500", tooltip: "Triggered" };
  return null;
}

/** Strip [Scheduled] / [Trigger] prefix for cleaner display */
function cleanTitle(title: string): string {
  return title.replace(/^\[(Scheduled|Trigger)\]\s*/, "") || "New Chat";
}

export function Sidebar() {
  const isConnected = useChatStore((s) => s.isConnected);
  const sessionId = useChatStore((s) => s.sessionId);
  const sessions = useChatStore((s) => s.sessions);
  const removeSession = useChatStore((s) => s.removeSession);
  const activeView = useSettingsStore((s) => s.activeView);
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const pendingInsightCount = useInsightStore((s) => s.pendingCount);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleNewChat = useCallback(() => {
    setActiveView("chat");
    window.dispatchEvent(new CustomEvent("new-chat"));
  }, [setActiveView]);

  const handleSwitchSession = useCallback(
    (targetId: string) => {
      if (targetId === sessionId) {
        // If already on this session but viewing a dashboard, switch to chat
        if (activeView !== "chat") setActiveView("chat");
        return;
      }
      setActiveView("chat");
      window.dispatchEvent(
        new CustomEvent("session-switch", { detail: { sessionId: targetId } })
      );
    },
    [sessionId, activeView, setActiveView]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`${API_URL}/api/sessions/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok || data.deleted === false) {
          console.error("Delete session failed:", data.error);
          return;
        }
        removeSession(id);
        // If deleting the active session, start a new chat
        if (id === sessionId) {
          handleNewChat();
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      } finally {
        setDeletingId(null);
      }
    },
    [removeSession, sessionId, handleNewChat]
  );

  const handleSearchOpen = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-search"));
  }, []);

  // Listen for switch-view events from action routing
  useEffect(() => {
    const handleSwitchView = (e: Event) => {
      const { view } = (e as CustomEvent).detail;
      if (view) setActiveView(view);
    };
    window.addEventListener("switch-view", handleSwitchView);
    return () =>
      window.removeEventListener("switch-view", handleSwitchView);
  }, [setActiveView]);

  return (
    <aside className="w-64 bg-bg-secondary border-r-2 border-border flex flex-col">
      {/* Sessions — always visible */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with New Chat + Search */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
              Sessions
            </h2>
            <div className="flex items-center gap-1">
              {/* Search button */}
              <button
                onClick={handleSearchOpen}
                className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-accent-primary hover:bg-bg-tertiary transition-colors"
                title="Search (Cmd+K)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </div>
          </div>

          {/* New Chat button */}
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-[2px] border border-accent-primary text-accent-primary hover:bg-accent-primary/10 transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-[11px] text-text-secondary/50 text-center">
              No sessions yet
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => handleSwitchSession(s.id)}
              className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-[2px] cursor-pointer transition-colors ${
                s.id === sessionId && activeView === "chat"
                  ? "bg-bg-tertiary border-l-2 border-accent-primary"
                  : "hover:bg-bg-tertiary border-l-2 border-transparent"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {sessionIndicator(s.title) && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${sessionIndicator(s.title)!.color} shrink-0`}
                      title={sessionIndicator(s.title)!.tooltip}
                    />
                  )}
                  <p className="text-sm font-medium text-text-primary truncate">
                    {cleanTitle(s.title) || "New Chat"}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-text-secondary/60">
                    {timeAgo(s.updatedAt)}
                  </span>
                  {s.messageCount > 0 && (
                    <span className="text-[10px] text-text-secondary/40">
                      {s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {s.totalCost > 0 && (
                    <span className="text-[10px] text-text-secondary/40 font-mono">
                      ${s.totalCost.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Delete button — visible on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(s.id);
                }}
                disabled={deletingId === s.id}
                className="absolute right-2 top-2.5 w-5 h-5 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete session"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* Connection status */}
        <div className="px-4 py-2 border-t border-border">
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? "bg-accent-tertiary" : "bg-error"
                }`}
              />
              {!isConnected && (
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-error animate-ping" />
              )}
            </div>
            <span className="text-[10px] text-text-secondary">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-1 border-t border-border">
        {/* Chat */}
        <button
          onClick={() => setActiveView("chat")}
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "chat"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Chat
        </button>

        {/* Org Chart */}
        <button
          onClick={() =>
            setActiveView(activeView === "orgchart" ? "chat" : "orgchart")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "orgchart"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Org Chart
        </button>

        {/* Skills */}
        <button
          onClick={() =>
            setActiveView(activeView === "skills" ? "chat" : "skills")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "skills"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Skills
        </button>

        {/* Files */}
        <button
          onClick={() =>
            setActiveView(activeView === "files" ? "chat" : "files")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "files"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Files
        </button>

        {/* Cost */}
        <button
          onClick={() =>
            setActiveView(activeView === "cost" ? "chat" : "cost")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "cost"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Cost
        </button>

        {/* Schedules */}
        <button
          onClick={() =>
            setActiveView(activeView === "schedules" ? "chat" : "schedules")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "schedules"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Schedules
        </button>

        {/* Triggers */}
        <button
          onClick={() =>
            setActiveView(activeView === "triggers" ? "chat" : "triggers")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "triggers"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Triggers
        </button>

        {/* Performance */}
        <button
          onClick={() =>
            setActiveView(
              activeView === "performance" ? "chat" : "performance"
            )
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors ${
            activeView === "performance"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          Performance
        </button>

        {/* Insights */}
        <button
          onClick={() =>
            setActiveView(activeView === "insights" ? "chat" : "insights")
          }
          className={`w-full text-left px-3 py-2 text-sm rounded-[2px] transition-colors flex items-center justify-between ${
            activeView === "insights"
              ? "text-accent-primary bg-bg-tertiary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          <span>Insights</span>
          {pendingInsightCount > 0 && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-[2px] bg-accent-tertiary text-bg-primary">
              {pendingInsightCount}
            </span>
          )}
        </button>
      </nav>
    </aside>
  );
}
