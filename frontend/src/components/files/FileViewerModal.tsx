"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { springs } from "@/lib/design-tokens";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FileInfo = {
  content: string | null;
  path: string;
  name: string;
  size: number;
  mime_type: string;
  editable: boolean;
};

type FileViewerModalProps = {
  filePath: string;
  fileName: string;
  onClose: () => void;
  onSaved?: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeBadge(mime: string, name: string): { label: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() || "";

  if (ext === "md" || ext === "mdx") return { label: "MARKDOWN", color: "text-accent-primary" };
  if (ext === "json" || ext === "jsonl") return { label: "JSON", color: "text-accent-tertiary" };
  if (ext === "py") return { label: "PYTHON", color: "text-[#3776AB]" };
  if (ext === "js" || ext === "jsx") return { label: "JAVASCRIPT", color: "text-[#F7DF1E]" };
  if (ext === "ts" || ext === "tsx") return { label: "TYPESCRIPT", color: "text-[#3178C6]" };
  if (ext === "css" || ext === "scss") return { label: "CSS", color: "text-[#264DE4]" };
  if (ext === "html" || ext === "htm") return { label: "HTML", color: "text-accent-secondary" };
  if (ext === "yaml" || ext === "yml") return { label: "YAML", color: "text-[#CB171E]" };
  if (ext === "csv") return { label: "CSV", color: "text-accent-tertiary" };
  if (ext === "sql") return { label: "SQL", color: "text-[#E38C00]" };
  if (ext === "sh" || ext === "bash") return { label: "SHELL", color: "text-accent-primary" };
  if (ext === "pdf") return { label: "PDF", color: "text-[#FF3B30]" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext))
    return { label: ext.toUpperCase(), color: "text-[#A855F7]" };
  if (mime.startsWith("text/")) return { label: "TEXT", color: "text-text-secondary" };
  return { label: ext.toUpperCase() || "FILE", color: "text-text-secondary" };
}

export function FileViewerModal({ filePath, fileName, onClose, onSaved }: FileViewerModalProps) {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = fileInfo?.editable && content !== originalContent;

  // Fetch file content
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/files/read?path=${encodeURIComponent(filePath)}`
        );
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else if (!cancelled) {
          setFileInfo(data);
          if (data.editable && data.content !== null) {
            setContent(data.content);
            setOriginalContent(data.content);
          }
        }
      } catch {
        if (!cancelled) setError("Failed to load file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filePath]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // Cmd/Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && fileInfo?.editable && isDirty) {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileInfo, isDirty, content]);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/save`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOriginalContent(content);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        onSaved?.();
      }
    } catch {
      setError("Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [isDirty, saving, filePath, content, onSaved]);

  const handleDownload = useCallback(() => {
    window.open(
      `${API_URL}/api/files/download?path=${encodeURIComponent(filePath)}`,
      "_blank"
    );
  }, [filePath]);

  const badge = fileInfo ? getFileTypeBadge(fileInfo.mime_type, fileInfo.name) : null;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const isMarkdown = fileInfo?.editable && (ext === "md" || ext === "mdx");
  const [mdMode, setMdMode] = useState<"preview" | "edit">("preview");
  const isImage = fileInfo?.mime_type.startsWith("image/") || false;
  const isPdf = fileInfo?.mime_type === "application/pdf";
  const isUnsupported = fileInfo && !fileInfo.editable && !isImage && !isPdf;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={springs.snappy}
          className="w-full max-w-5xl h-[90vh] flex flex-col bg-bg-secondary border-2 border-border rounded-[2px] shadow-[8px_8px_0_0_rgba(200,255,0,0.1)] overflow-hidden"
        >
          {/* ── Header ────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-primary/50">
            <div className="flex items-center gap-3 min-w-0">
              {/* File type badge */}
              {badge && (
                <span
                  className={`shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-current/20 rounded-[2px] ${badge.color}`}
                >
                  {badge.label}
                </span>
              )}
              {/* Filename */}
              <span className="text-sm font-mono text-text-primary truncate">
                {fileName}
              </span>
              {/* Size */}
              {fileInfo && (
                <span className="shrink-0 text-[10px] text-text-secondary/50 font-mono">
                  {formatBytes(fileInfo.size)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Preview / Edit toggle for markdown files */}
              {isMarkdown && !loading && (
                <div className="flex items-center bg-bg-tertiary rounded-[2px] border border-border p-0.5">
                  <button
                    onClick={() => setMdMode("preview")}
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-[1px] transition-colors ${
                      mdMode === "preview"
                        ? "bg-accent-primary text-bg-primary"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setMdMode("edit")}
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-[1px] transition-colors ${
                      mdMode === "edit"
                        ? "bg-accent-primary text-bg-primary"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Edit
                  </button>
                </div>
              )}

              {/* Download button */}
              <button
                onClick={handleDownload}
                title="Download"
                className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-accent-primary hover:bg-bg-tertiary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>

              {/* Close button */}
              <button
                onClick={onClose}
                title="Close (Esc)"
                className="w-7 h-7 flex items-center justify-center rounded-[2px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Content ───────────────────────────────── */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-5 h-5 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-[11px] text-text-secondary/50 uppercase tracking-wider">
                    Loading file...
                  </p>
                </div>
              </div>
            ) : error && !fileInfo ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-error/50">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <p className="text-sm text-error">{error}</p>
                </div>
              </div>
            ) : isMarkdown && mdMode === "preview" ? (
              /* ── Markdown preview ──────────────────── */
              <div className="flex-1 w-full bg-bg-primary overflow-auto p-6 select-text">
                <MarkdownRenderer content={content} />
              </div>
            ) : fileInfo?.editable ? (
              /* ── Text editor ──────────────────────── */
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full bg-bg-primary text-text-primary font-mono text-[13px] leading-relaxed p-4 resize-none focus:outline-none border-none placeholder:text-text-secondary/30 overflow-auto"
                style={{ tabSize: 2 }}
              />
            ) : isImage && fileInfo?.content ? (
              /* ── Image viewer ─────────────────────── */
              <div className="flex-1 flex items-center justify-center p-6 overflow-auto bg-bg-primary">
                <img
                  src={fileInfo.content}
                  alt={fileInfo.name}
                  className="max-w-full max-h-full object-contain rounded-[2px]"
                  style={{ imageRendering: "auto" }}
                />
              </div>
            ) : isPdf && fileInfo?.content ? (
              /* ── PDF viewer ───────────────────────── */
              <div className="flex-1 overflow-hidden bg-bg-primary">
                <iframe
                  src={fileInfo.content}
                  title={fileInfo.name}
                  className="w-full h-full border-none"
                />
              </div>
            ) : isUnsupported ? (
              /* ── Unsupported file ─────────────────── */
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-text-secondary/30">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p className="text-sm text-text-secondary/60 mb-1">
                    Preview not available
                  </p>
                  <p className="text-[10px] text-text-secondary/40 mb-4">
                    This file type cannot be previewed in the browser
                  </p>
                  <button
                    onClick={handleDownload}
                    className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 transition-colors"
                  >
                    Download File
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* ── Footer (editable files only) ──────────── */}
          {fileInfo?.editable && !loading && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-bg-primary/50">
              <div className="flex items-center gap-2">
                {/* Error message */}
                {error && (
                  <span className="text-[11px] text-error">
                    {error}
                  </span>
                )}
                {/* Save success */}
                {saveSuccess && (
                  <span className="text-[11px] text-accent-tertiary flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved
                  </span>
                )}
                {/* Dirty indicator */}
                {isDirty && !saveSuccess && !error && (
                  <span className="text-[11px] text-accent-secondary flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-secondary" />
                    Unsaved changes
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-secondary/30 mr-1 font-mono">
                  {fileInfo?.editable ? "⌘S" : ""}
                </span>
                <button
                  onClick={onClose}
                  className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
                >
                  {isDirty ? "Discard" : "Close"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] bg-accent-primary text-bg-primary hover:bg-accent-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
