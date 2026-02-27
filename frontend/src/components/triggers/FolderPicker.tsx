"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FolderItem = {
  name: string;
  type: "file" | "folder";
};

/* ── Props ─────────────────────────────────────────────────────── */

type FolderPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
};

/* ── Folder icon (inline SVG) ──────────────────────────────────── */

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent-primary/70 shrink-0"
    >
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export function FolderPicker({ open, onClose, onSelect }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New folder
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Fetch folders ─────────────────────────────────────────── */

  const fetchFolders = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/files?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setFolders([]);
      } else {
        // Only show folders
        setFolders(
          (data.items || []).filter((i: FolderItem) => i.type === "folder")
        );
      }
    } catch {
      setError("Failed to load folders");
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchFolders(currentPath);
    }
  }, [open, currentPath, fetchFolders]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setCurrentPath("");
      setShowNewFolder(false);
      setNewFolderName("");
      setError(null);
    }
  }, [open]);

  /* ── Click outside ─────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    // Delay to avoid the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, onClose]);

  /* ── Navigation ────────────────────────────────────────────── */

  const navigateInto = useCallback((folderName: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${folderName}` : folderName));
    setShowNewFolder(false);
    setNewFolderName("");
  }, []);

  const navigateUp = useCallback(() => {
    setCurrentPath((prev) => {
      const segments = prev.split("/");
      segments.pop();
      return segments.join("/");
    });
    setShowNewFolder(false);
    setNewFolderName("");
  }, []);

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setCurrentPath("");
    } else {
      setCurrentPath((prev) => {
        const segments = prev.split("/");
        return segments.slice(0, index + 1).join("/");
      });
    }
    setShowNewFolder(false);
    setNewFolderName("");
  }, []);

  /* ── Create folder ─────────────────────────────────────────── */

  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const path = currentPath ? `${currentPath}/${trimmed}` : trimmed;
    try {
      const res = await fetch(`${API_URL}/api/files/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setNewFolderName("");
        setShowNewFolder(false);
        fetchFolders(currentPath);
      }
    } catch {
      setError("Failed to create folder");
    }
  }, [newFolderName, currentPath, fetchFolders]);

  /* ── Select current path ───────────────────────────────────── */

  const handleSelect = useCallback(() => {
    onSelect(currentPath);
    onClose();
  }, [currentPath, onSelect, onClose]);

  /* ── Render ────────────────────────────────────────────────── */

  if (!open) return null;

  const breadcrumbSegments = currentPath ? currentPath.split("/") : [];

  return (
    <div
      ref={containerRef}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-bg-primary border border-border rounded-[2px] shadow-lg max-h-72 flex flex-col"
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border text-[10px] font-mono">
        <button
          onClick={() => navigateToBreadcrumb(-1)}
          className={`hover:text-accent-primary transition-colors ${
            currentPath ? "text-text-secondary" : "text-accent-primary"
          }`}
        >
          working
        </button>
        {breadcrumbSegments.map((segment, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-text-secondary/30">/</span>
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className={`hover:text-accent-primary transition-colors ${
                i === breadcrumbSegments.length - 1
                  ? "text-accent-primary"
                  : "text-text-secondary"
              }`}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-error bg-error/10 border-b border-border">
          {error}
        </div>
      )}

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-center">
            <span className="text-[11px] text-text-secondary/40">
              Loading...
            </span>
          </div>
        ) : (
          <>
            {/* Go up */}
            {currentPath && (
              <button
                onClick={navigateUp}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary transition-colors text-left"
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
                  className="shrink-0"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                ..
              </button>
            )}

            {/* Folder rows */}
            {folders.map((f) => (
              <button
                key={f.name}
                onClick={() => navigateInto(f.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors text-left"
              >
                <FolderIcon />
                <span className="truncate">{f.name}</span>
              </button>
            ))}

            {/* Empty state */}
            {folders.length === 0 && !currentPath && (
              <div className="px-3 py-4 text-center">
                <span className="text-[11px] text-text-secondary/40">
                  No folders yet
                </span>
              </div>
            )}
            {folders.length === 0 && currentPath && (
              <div className="px-3 py-3 text-center">
                <span className="text-[11px] text-text-secondary/40">
                  No subfolders
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* New folder inline form */}
      {showNewFolder && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") {
                setShowNewFolder(false);
                setNewFolderName("");
              }
            }}
            placeholder="Folder name..."
            autoFocus
            className="flex-1 bg-bg-tertiary text-text-primary text-[11px] px-2 py-1 border border-border rounded-[2px] focus:outline-none focus:border-accent-primary font-mono placeholder:text-text-secondary/30"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim()}
            className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 disabled:opacity-30 transition-colors"
          >
            Create
          </button>
        </div>
      )}

      {/* Footer: New Folder + Select */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <button
          onClick={() => {
            setShowNewFolder((v) => !v);
            setNewFolderName("");
          }}
          className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary transition-colors"
        >
          {showNewFolder ? "Cancel" : "+ New Folder"}
        </button>
        <button
          onClick={handleSelect}
          className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] border border-accent-primary text-accent-primary hover:bg-accent-primary/10 transition-colors"
        >
          Select This
        </button>
      </div>
    </div>
  );
}
