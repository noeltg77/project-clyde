"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { FileViewerModal } from "./FileViewerModal";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FileItem = {
  name: string;
  type: "file" | "folder";
  size: number | null;
  modified_at: string;
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function FileIcon({ name, type }: { name: string; type: "file" | "folder" }) {
  if (type === "folder") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary/70">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    );
  }
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "md") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary/50">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    );
  }
  if (ext === "json" || ext === "jsonl") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary/50">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary/50">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function FileBrowser() {
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create folder state
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<{
    name: string;
    type: string;
  } | null>(null);

  // File viewer modal
  const [viewerFile, setViewerFile] = useState<{
    name: string;
    path: string;
  } | null>(null);

  // Drag and drop
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Hidden file input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/files?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setItems([]);
      } else {
        setItems(data.items || []);
      }
    } catch {
      setError("Failed to load files");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath, fetchFiles]);

  const navigateToFolder = useCallback((folderName: string) => {
    setCurrentPath((prev) =>
      prev ? `${prev}/${folderName}` : folderName
    );
    setConfirmDelete(null);
    setShowCreateFolder(false);
  }, []);

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setCurrentPath("");
    } else {
      const segments = currentPath.split("/");
      setCurrentPath(segments.slice(0, index + 1).join("/"));
    }
    setConfirmDelete(null);
    setShowCreateFolder(false);
  }, [currentPath]);

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
        setShowCreateFolder(false);
        fetchFiles(currentPath);
      }
    } catch {
      setError("Failed to create folder");
    }
  }, [newFolderName, currentPath, fetchFiles]);

  const handleUpload = useCallback(
    async (fileList: FileList) => {
      const formData = new FormData();
      for (const file of Array.from(fileList)) {
        formData.append("files", file);
      }
      formData.append("path", currentPath);
      try {
        const res = await fetch(`${API_URL}/api/files/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          fetchFiles(currentPath);
        }
      } catch {
        setError("Failed to upload files");
      }
    },
    [currentPath, fetchFiles]
  );

  const handleOpenFile = useCallback(
    (fileName: string) => {
      const fullPath = currentPath
        ? `${currentPath}/${fileName}`
        : fileName;
      setViewerFile({ name: fileName, path: fullPath });
    },
    [currentPath]
  );

  const handleDownload = useCallback(
    (fileName: string) => {
      const fullPath = currentPath
        ? `${currentPath}/${fileName}`
        : fileName;
      window.open(
        `${API_URL}/api/files/download?path=${encodeURIComponent(fullPath)}`,
        "_blank"
      );
    },
    [currentPath]
  );

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const path = currentPath
      ? `${currentPath}/${confirmDelete.name}`
      : confirmDelete.name;
    try {
      const res = await fetch(`${API_URL}/api/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setConfirmDelete(null);
        fetchFiles(currentPath);
      }
    } catch {
      setError("Failed to delete");
    }
  }, [confirmDelete, currentPath, fetchFiles]);

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    },
    [handleUpload]
  );

  const breadcrumbSegments = currentPath ? currentPath.split("/") : [];

  const handleStartChat = useCallback(() => {
    setActiveView("chat");
    window.dispatchEvent(new CustomEvent("new-chat"));
    // Brief delay for WS to connect before setting folder context
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("set-folder-context", {
          detail: { folderPath: currentPath || "" },
        })
      );
    }, 100);
  }, [setActiveView, currentPath]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary font-display">
              Files
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartChat}
                className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-accent-primary text-accent-primary hover:bg-accent-primary/10 transition-colors"
              >
                Start Chat
              </button>
              <button
                onClick={() => {
                  setShowCreateFolder((v) => !v);
                  setNewFolderName("");
                }}
                className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
              >
                New Folder
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 transition-colors"
              >
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleUpload(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 mt-3 text-[11px] font-mono">
            <button
              onClick={() => navigateToBreadcrumb(-1)}
              className={`hover:text-accent-primary transition-colors ${
                currentPath
                  ? "text-text-secondary"
                  : "text-accent-primary"
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
        </div>
      </div>

      {/* Create folder inline form */}
      {showCreateFolder && (
        <div className="px-6 pt-3">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowCreateFolder(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name..."
              autoFocus
              className="flex-1 bg-bg-tertiary text-text-primary text-sm px-3 py-1.5 border border-border rounded-[2px] focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-secondary/50 font-mono"
            />
            <button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 disabled:opacity-30 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowCreateFolder(false);
                setNewFolderName("");
              }}
              className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-6 pt-3">
          <div className="max-w-4xl mx-auto">
            <div className="px-3 py-2 text-sm text-error bg-error/10 border border-error/20 rounded-[2px]">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 text-error/70 hover:text-error"
              >
                dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File list */}
      <div
        className="flex-1 overflow-y-auto p-6 pt-4 relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="max-w-4xl mx-auto">
          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/80 border-2 border-dashed border-accent-primary rounded-[2px]">
              <div className="text-center">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-auto mb-2 text-accent-primary"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="text-sm font-semibold text-accent-primary">
                  Drop files to upload
                </p>
                <p className="text-[10px] text-text-secondary mt-1">
                  to {currentPath || "working/"}
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-10 bg-bg-tertiary rounded-[2px] animate-pulse"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto mb-3 text-text-secondary/30"
              >
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <p className="text-sm text-text-secondary/50">
                Empty directory
              </p>
              <p className="text-[10px] text-text-secondary/30 mt-1">
                Upload files or create a folder to get started
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-[2px] overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_80px_100px_80px] gap-2 px-3 py-2 bg-bg-secondary border-b border-border">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
                  Name
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 text-right">
                  Size
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 text-right">
                  Modified
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50 text-right">
                  Actions
                </span>
              </div>

              {/* Go up row */}
              {currentPath && (
                <button
                  onClick={() => {
                    const segments = currentPath.split("/");
                    segments.pop();
                    setCurrentPath(segments.join("/"));
                  }}
                  className="w-full grid grid-cols-[1fr_80px_100px_80px] gap-2 px-3 py-2.5 border-b border-border/50 hover:bg-bg-secondary/50 transition-colors text-left"
                >
                  <span className="flex items-center gap-2 text-sm text-text-secondary">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    ..
                  </span>
                  <span />
                  <span />
                  <span />
                </button>
              )}

              {/* File rows */}
              {items.map((item) => (
                <div
                  key={item.name}
                  className="grid grid-cols-[1fr_80px_100px_80px] gap-2 px-3 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-bg-secondary/50 transition-colors group"
                >
                  {/* Name */}
                  <button
                    onClick={() => {
                      if (item.type === "folder") {
                        navigateToFolder(item.name);
                      } else {
                        handleOpenFile(item.name);
                      }
                    }}
                    className="flex items-center gap-2 text-sm text-text-primary hover:text-accent-primary transition-colors text-left truncate"
                  >
                    <FileIcon name={item.name} type={item.type} />
                    <span className="truncate">{item.name}</span>
                  </button>

                  {/* Size */}
                  <span className="text-[11px] text-text-secondary/60 font-mono text-right self-center">
                    {item.type === "file" ? formatSize(item.size) : "\u2014"}
                  </span>

                  {/* Modified */}
                  <span className="text-[11px] text-text-secondary/60 text-right self-center">
                    {timeAgo(item.modified_at)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1 self-center">
                    {/* Delete confirmation inline */}
                    {confirmDelete?.name === item.name ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleDelete}
                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-error text-white rounded-[2px] hover:bg-error/80 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase border border-border text-text-secondary rounded-[2px] hover:text-text-primary transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        {item.type === "file" && (
                          <button
                            onClick={() => handleDownload(item.name)}
                            title="Download"
                            className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-accent-primary hover:bg-bg-tertiary opacity-0 group-hover:opacity-100 transition-all"
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
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setConfirmDelete({
                              name: item.name,
                              type: item.type,
                            })
                          }
                          title="Delete"
                          className="w-6 h-6 flex items-center justify-center rounded-[2px] text-text-secondary/40 hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all"
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
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File viewer modal */}
      {viewerFile && (
        <FileViewerModal
          filePath={viewerFile.path}
          fileName={viewerFile.name}
          onClose={() => setViewerFile(null)}
          onSaved={() => fetchFiles(currentPath)}
        />
      )}
    </div>
  );
}
