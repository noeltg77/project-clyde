"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useChatStore } from "@/stores/chat-store-provider";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FileEntry = {
  path: string;
  name: string;
  folder: string;
};

type Attachment = {
  name: string;
  path: string;
};

type ChatInputProps = {
  onSend: (message: string, fileRefs?: string[], folderContext?: string) => void;
  onCancel: () => void;
};

export function ChatInput({ onSend, onCancel }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isConnected = useChatStore((s) => s.isConnected);

  // @-mention state
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Upload attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Folder context state (set via FileBrowser "Start Chat" button)
  const [folderContext, setFolderContext] = useState<string | null>(null);

  // Fetch file tree on mount for autocomplete
  useEffect(() => {
    async function fetchFileTree() {
      try {
        const res = await fetch(`${API_URL}/api/files/tree`);
        const data = await res.json();
        setAllFiles(data.files || []);
      } catch {
        // Non-critical — autocomplete just won't work
      }
    }
    fetchFileTree();
  }, []);

  // Listen for prefill-message events (used by insights routing)
  useEffect(() => {
    const handlePrefill = (e: Event) => {
      const content = (e as CustomEvent).detail?.content;
      if (content) {
        setValue(content);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("prefill-message", handlePrefill);
    return () => window.removeEventListener("prefill-message", handlePrefill);
  }, []);

  // Listen for auto-send-message events (insight "Act" actions — sends immediately)
  useEffect(() => {
    const handleAutoSend = (e: Event) => {
      const content = (e as CustomEvent).detail?.content;
      if (content) {
        onSend(content);
      }
    };
    window.addEventListener("auto-send-message", handleAutoSend);
    return () => window.removeEventListener("auto-send-message", handleAutoSend);
  }, [onSend]);

  // Listen for set-folder-context events (FileBrowser "Start Chat" button)
  useEffect(() => {
    const handleSetFolderContext = (e: Event) => {
      const folderPath = (e as CustomEvent).detail?.folderPath;
      if (folderPath !== undefined) {
        setFolderContext(folderPath);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("set-folder-context", handleSetFolderContext);
    return () => window.removeEventListener("set-folder-context", handleSetFolderContext);
  }, []);

  // Clear folder context when a new chat is started manually
  useEffect(() => {
    const handleNewChat = () => {
      setFolderContext(null);
    };
    window.addEventListener("new-chat", handleNewChat);
    return () => window.removeEventListener("new-chat", handleNewChat);
  }, []);

  const filteredFiles = useMemo(() => {
    if (!showFilePicker) return [];
    if (!fileQuery) return allFiles.slice(0, 10);
    const q = fileQuery.toLowerCase();
    return allFiles
      .filter(
        (f) =>
          f.path.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [allFiles, fileQuery, showFilePicker]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      const cursorPos = textareaRef.current?.selectionStart || 0;
      const textBeforeCursor = value.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex === -1) return;

      // Replace @query with @filepath
      const newValue =
        value.slice(0, atIndex) + `@${filePath} ` + value.slice(cursorPos);
      setValue(newValue);

      // Track the reference
      if (!fileRefs.includes(filePath)) {
        setFileRefs((prev) => [...prev, filePath]);
      }

      setShowFilePicker(false);
      setFileQuery("");

      // Focus and place cursor after the inserted text
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = atIndex + filePath.length + 2; // @filepath + space
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [value, fileRefs]
  );

  const removeFileRef = useCallback((ref: string) => {
    setFileRefs((prev) => prev.filter((r) => r !== ref));
  }, []);

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  }, []);

  // Upload files via the existing backend endpoint
  const handleFileUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("files", file);
      }
      formData.append("path", "uploads");

      const res = await fetch(`${API_URL}/api/files/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.uploaded && Array.isArray(data.uploaded)) {
        const newAttachments: Attachment[] = data.uploaded.map(
          (fileName: string) => ({
            name: fileName,
            path: `uploads/${fileName}`,
          })
        );
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    } catch (err) {
      console.error("File upload failed:", err);
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming || !isConnected) return;

    // Collect all file refs — tracked ones plus any @paths in text plus attachments
    const refs = [...fileRefs];

    // Add attachment paths
    for (const att of attachments) {
      if (!refs.includes(att.path)) {
        refs.push(att.path);
      }
    }

    const atMatches = trimmed.match(/@([\w/.\-]+)/g);
    if (atMatches) {
      for (const match of atMatches) {
        const path = match.slice(1);
        if (!refs.includes(path) && allFiles.some((f) => f.path === path)) {
          refs.push(path);
        }
      }
    }

    onSend(
      trimmed || "(see attached files)",
      refs.length > 0 ? refs : undefined,
      folderContext ?? undefined
    );
    setValue("");
    setFileRefs([]);
    setAttachments([]);
    setFolderContext(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, isConnected, onSend, fileRefs, attachments, allFiles, folderContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle file picker keyboard navigation
    if (showFilePicker && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredFiles.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleFileSelect(filteredFiles[selectedIndex].path);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFilePicker(false);
        return;
      }
    }

    // Normal Enter to send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Auto-resize textarea
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";

    // Detect @ mention
    const cursorPos = el.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      const query = textBeforeCursor.slice(atIndex + 1);
      // Active mention: no space or newline between @ and cursor
      if (!query.includes(" ") && !query.includes("\n")) {
        setFileQuery(query);
        setShowFilePicker(true);
        setSelectedIndex(0);
        return;
      }
    }
    setShowFilePicker(false);
  };

  const hasChips = fileRefs.length > 0 || attachments.length > 0 || folderContext !== null;

  return (
    <div className="border-t-2 border-border bg-bg-secondary">
      {/* File reference + attachment chips */}
      {hasChips && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-border/50">
          {folderContext !== null && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-blue-500/15 text-blue-400 rounded-[2px] border border-blue-500/30">
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {folderContext ? `working/${folderContext}` : "working/"}
              <button
                onClick={() => setFolderContext(null)}
                className="hover:text-error ml-0.5 transition-colors"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          )}
          {fileRefs.map((ref) => (
            <span
              key={`ref-${ref}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-accent-primary/15 text-accent-primary rounded-[2px] border border-accent-primary/30"
            >
              @{ref}
              <button
                onClick={() => removeFileRef(ref)}
                className="hover:text-error ml-0.5 transition-colors"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
          {attachments.map((att) => (
            <span
              key={`att-${att.path}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-accent-tertiary/15 text-accent-tertiary rounded-[2px] border border-accent-tertiary/30"
            >
              {/* Paperclip mini icon */}
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
              {att.name}
              <button
                onClick={() => removeAttachment(att.path)}
                className="hover:text-error ml-0.5 transition-colors"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative p-4">
        {/* File picker popover */}
        {showFilePicker && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-bg-tertiary border-2 border-border rounded-[2px] max-h-48 overflow-y-auto z-50 shadow-lg">
            <div className="px-3 py-1.5 border-b border-border/50">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-text-secondary/50">
                Files
              </span>
            </div>
            {filteredFiles.map((file, i) => (
              <button
                key={file.path}
                onClick={() => handleFileSelect(file.path)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                  i === selectedIndex
                    ? "bg-accent-primary/15 text-accent-primary"
                    : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                }`}
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
                  className="flex-shrink-0 opacity-50"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="font-mono text-[11px] truncate">
                  {file.name}
                </span>
                {file.folder && (
                  <span className="text-[10px] text-text-secondary/40 ml-auto font-mono flex-shrink-0">
                    {file.folder}/
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFileUpload(e.target.files);
          }}
        />

        <div className="flex gap-3 items-end">
          {/* Paperclip upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected || uploading}
            title="Attach files"
            className="p-3 text-text-secondary hover:text-accent-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="animate-spin"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              isConnected
                ? folderContext !== null
                  ? `Ask about files in ${folderContext ? `working/${folderContext}` : "working/"}...`
                  : "Type a message... (@ to reference files)"
                : "Connecting to Clyde..."
            }
            disabled={!isConnected}
            rows={1}
            className="flex-1 bg-bg-tertiary text-text-primary text-sm px-4 py-3 border-2 border-border rounded-[2px] resize-none focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-secondary/50 disabled:opacity-50 font-sans"
          />
          {isStreaming ? (
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-red-600 text-white font-semibold text-sm rounded-[2px] border-2 border-red-600 hover:bg-red-700 hover:border-red-700 transition-all active:scale-95"
            >
              STOP
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!value.trim() && attachments.length === 0) || !isConnected}
              className="px-6 py-3 bg-accent-primary text-bg-primary font-semibold text-sm rounded-[2px] border-2 border-accent-primary hover:bg-accent-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              SEND
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
