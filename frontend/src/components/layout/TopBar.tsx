"use client";

import { useEffect, useState } from "react";
import { Settings, Heart } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store-provider";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function TopBar() {
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const [todayCost, setTodayCost] = useState<number | null>(null);

  // Fetch today's cost on mount + after every assistant response
  useEffect(() => {
    async function fetchCost() {
      try {
        const res = await fetch(`${API_URL}/api/cost`);
        const data = await res.json();
        if (typeof data.today_usd === "number") {
          setTodayCost(data.today_usd);
        }
      } catch {
        // Silently fail — cost display is non-critical
      }
    }

    fetchCost();
    window.addEventListener("cost-updated", fetchCost);
    return () => window.removeEventListener("cost-updated", fetchCost);
  }, []);

  return (
    <header className="h-14 bg-bg-secondary border-b-2 border-border flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold text-accent-primary tracking-tight">
          CLYDE
        </h1>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
          CEO
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Live cost display */}
        {todayCost !== null && (
          <span className="text-sm font-mono text-accent-primary">
            ${todayCost.toFixed(2)}{" "}
            <span className="text-[10px] text-text-secondary/60 uppercase tracking-wider">
              today
            </span>
          </span>
        )}

        <button
          onClick={toggleSettings}
          className="w-8 h-8 flex items-center justify-center border-2 border-border hover:border-accent-primary transition-colors rounded-[2px] text-text-secondary hover:text-accent-primary"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>

        <a
          href="https://www.patreon.com/cw/ProjectClyde"
          target="_blank"
          rel="noopener noreferrer"
          className="h-8 flex items-center gap-1.5 px-2.5 border-2 border-border hover:border-accent-primary transition-colors rounded-[2px] text-text-secondary hover:text-accent-primary"
          aria-label="Show Support"
        >
          <Heart size={14} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            Show Support
          </span>
        </a>
      </div>
    </header>
  );
}
