"use client";

import { useEffect, useState } from "react";
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
        if (typeof data.today_gbp === "number") {
          setTodayCost(data.today_gbp);
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
            £{todayCost.toFixed(2)}{" "}
            <span className="text-[10px] text-text-secondary/60 uppercase tracking-wider">
              today
            </span>
          </span>
        )}

        <button
          onClick={toggleSettings}
          className="w-8 h-8 flex items-center justify-center border-2 border-border hover:border-accent-primary transition-colors rounded-[2px]"
          aria-label="Settings"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-text-secondary hover:text-accent-primary"
          >
            <path
              d="M8 10a2 2 0 100-4 2 2 0 000 4z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M13.5 8a5.5 5.5 0 01-.3 1.8l1.4 1.1-1 1.7-1.7-.5a5.5 5.5 0 01-1.5.9L10 14.7H8l-.4-1.7a5.5 5.5 0 01-1.5-.9l-1.7.5-1-1.7 1.4-1.1A5.5 5.5 0 014.5 8c0-.6.1-1.2.3-1.8L3.4 5.1l1-1.7 1.7.5a5.5 5.5 0 011.5-.9L8 1.3h2l.4 1.7a5.5 5.5 0 011.5.9l1.7-.5 1 1.7-1.4 1.1c.2.6.3 1.2.3 1.8z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
