"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { motion, AnimatePresence } from "motion/react";

type SearchResult = {
  id: string;
  content: string;
  role: string;
  agentName: string;
  sessionId: string;
  similarity: number;
  createdAt: string;
};

export function SearchPanel() {
  const isSearchOpen = useSettingsStore((s) => s.isSearchOpen);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }, [isSearchOpen]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else if (data.results) {
        setResults(
          data.results.map(
            (r: {
              id: string;
              content: string;
              role: string;
              agent_name?: string;
              session_id: string;
              similarity: number;
              created_at: string;
            }) => ({
              id: r.id,
              content: r.content,
              role: r.role,
              agentName: r.agent_name || r.role,
              sessionId: r.session_id,
              similarity: r.similarity,
              createdAt: r.created_at,
            })
          )
        );
      }
    } catch (err) {
      console.error("Search failed:", err);
      setError("Search unavailable");
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch]
  );

  const handleResultClick = useCallback(
    (sessionId: string) => {
      setSearchOpen(false);
      window.dispatchEvent(
        new CustomEvent("session-switch", { detail: { sessionId } })
      );
    },
    [setSearchOpen]
  );

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSearchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isSearchOpen, setSearchOpen]);

  return (
    <AnimatePresence>
      {isSearchOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 z-50"
            onClick={() => setSearchOpen(false)}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed top-16 left-1/2 -translate-x-1/2 w-full max-w-xl z-50"
          >
            <div className="bg-bg-secondary border-2 border-border rounded-[2px] shadow-2xl overflow-hidden">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-text-secondary flex-shrink-0"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search chat history..."
                  className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-secondary/50 outline-none"
                />
                {isSearching && (
                  <div className="w-4 h-4 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                )}
                <kbd className="text-[10px] text-text-secondary/40 font-mono px-1.5 py-0.5 bg-bg-tertiary rounded-[2px]">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto">
                {error && (
                  <div className="px-4 py-6 text-center text-sm text-error/70">
                    {error}
                  </div>
                )}

                {!error && results.length === 0 && query.trim() && !isSearching && (
                  <div className="px-4 py-6 text-center text-sm text-text-secondary/50">
                    No results found
                  </div>
                )}

                {results.length === 0 && !query.trim() && (
                  <div className="px-4 py-6 text-center text-sm text-text-secondary/50">
                    Search across all your conversations
                  </div>
                )}

                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleResultClick(r.sessionId)}
                    className="w-full text-left px-4 py-3 hover:bg-bg-tertiary transition-colors border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-accent-primary/70">
                        {(r.similarity * 100).toFixed(0)}%
                      </span>
                      <span className="text-[10px] text-text-secondary/60">
                        {r.agentName}
                      </span>
                      <span className="text-[10px] text-text-secondary/40">
                        {new Date(r.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-text-primary line-clamp-2">
                      {r.content}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
