"use client";

import { useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ActivityPanel } from "./ActivityPanel";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { PermissionStack } from "@/components/permissions/PermissionStack";
import { InsightStack } from "@/components/insights/InsightStack";
import { SearchPanel } from "@/components/search/SearchPanel";
import { OnboardingOverlay } from "@/components/onboarding/OnboardingOverlay";
import { OrgChart } from "@/components/agents/OrgChart";
import { ActiveAgentOverlay } from "@/components/agents/ActiveAgentOverlay";
import { CostDashboard } from "@/components/cost/CostDashboard";
import { PerformanceDashboard } from "@/components/performance/PerformanceDashboard";
import { InsightsDashboard } from "@/components/insights/InsightsDashboard";
import { ScheduleManager } from "@/components/schedules/ScheduleManager";
import { TriggerManager } from "@/components/triggers/TriggerManager";
import { SkillsDashboard } from "@/components/skills/SkillsDashboard";
import { FileBrowser } from "@/components/files/FileBrowser";
import { useAgentStore } from "@/stores/agent-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";

export function AppShell() {
  const removePendingPermission = useAgentStore(
    (s) => s.removePendingPermission
  );
  const toggleSearch = useSettingsStore((s) => s.toggleSearch);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const activeView = useSettingsStore((s) => s.activeView);

  // Permission response handler — sends via WebSocket
  // ChatContainer owns the WS connection, but PermissionStack needs to send too.
  // We use a global event approach: dispatch a custom DOM event that ChatContainer listens for.
  const handlePermissionResponse = useCallback(
    (id: string, decision: string) => {
      // Dispatch custom event for ChatContainer to pick up
      window.dispatchEvent(
        new CustomEvent("permission-response", {
          detail: { id, decision },
        })
      );
      removePendingPermission(id);
    },
    [removePendingPermission]
  );

  // Cmd+K keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearch]);

  // Listen for open-search events from Sidebar
  useEffect(() => {
    const handleOpenSearch = () => setSearchOpen(true);
    window.addEventListener("open-search", handleOpenSearch);
    return () => window.removeEventListener("open-search", handleOpenSearch);
  }, [setSearchOpen]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Chat always mounted (hidden when dashboard active) to preserve WebSocket */}
          <div className={activeView === "chat" ? "flex-1 flex flex-col overflow-hidden" : "hidden"}>
            <ChatContainer />
          </div>

          {/* Dashboard overlay — animated in/out */}
          <AnimatePresence mode="wait">
            {activeView !== "chat" && (
              <motion.div
                key={activeView}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex flex-col overflow-hidden bg-bg-primary"
              >
                {activeView === "orgchart" && <OrgChart />}
                {activeView === "skills" && <SkillsDashboard />}
                {activeView === "cost" && <CostDashboard />}
                {activeView === "schedules" && <ScheduleManager />}
                {activeView === "triggers" && <TriggerManager />}
                {activeView === "performance" && <PerformanceDashboard />}
                {activeView === "insights" && <InsightsDashboard />}
                {activeView === "files" && <FileBrowser />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating agent cards — animate in/out from right when subagents are active */}
          <ActiveAgentOverlay />
        </main>
        <ActivityPanel />
      </div>
      <SettingsPanel />
      <PermissionStack onRespond={handlePermissionResponse} />
      <InsightStack />
      <SearchPanel />
      <OnboardingOverlay />
    </div>
  );
}
