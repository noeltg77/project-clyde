"use client";

import { useState } from "react";
import { ReadOnlyFileModal } from "./ReadOnlyFileModal";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type FileAttachmentCardProps = {
  filePath: string;
  fileName: string;
};

function getFileTypeLabel(fileName: string): { label: string; ext: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "md":
    case "mdx":
      return { label: "Document", ext: "MD" };
    case "json":
    case "jsonl":
      return { label: "Data", ext: "JSON" };
    case "csv":
      return { label: "Spreadsheet", ext: "CSV" };
    case "py":
      return { label: "Script", ext: "PY" };
    case "js":
    case "jsx":
      return { label: "Script", ext: "JS" };
    case "ts":
    case "tsx":
      return { label: "Script", ext: "TS" };
    case "html":
    case "htm":
      return { label: "Webpage", ext: "HTML" };
    case "css":
    case "scss":
      return { label: "Stylesheet", ext: "CSS" };
    case "yaml":
    case "yml":
      return { label: "Config", ext: "YAML" };
    case "sql":
      return { label: "Query", ext: "SQL" };
    case "sh":
    case "bash":
      return { label: "Script", ext: "SH" };
    case "txt":
      return { label: "Document", ext: "TXT" };
    case "pdf":
      return { label: "Document", ext: "PDF" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return { label: "Image", ext: ext.toUpperCase() };
    default:
      return { label: "File", ext: ext.toUpperCase() || "FILE" };
  }
}

export function FileAttachmentCard({ filePath, fileName }: FileAttachmentCardProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const { label, ext } = getFileTypeLabel(fileName);

  const handleDownload = () => {
    window.open(
      `${API_URL}/api/files/download?path=${encodeURIComponent(filePath)}`,
      "_blank"
    );
  };

  return (
    <>
      <div className="flex items-center gap-3 p-3 mt-3 bg-bg-tertiary border border-border rounded-[2px] group">
        {/* File icon */}
        <div className="w-10 h-10 shrink-0 flex items-center justify-center bg-bg-primary/50 border border-border/50 rounded-[2px]">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-secondary/60"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {fileName}
          </p>
          <p className="text-[11px] text-text-secondary/50">
            {label} &middot; {ext}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setViewerOpen(true)}
            className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            View
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-[2px] border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            Download
          </button>
        </div>
      </div>

      {/* Read-only file viewer modal */}
      {viewerOpen && (
        <ReadOnlyFileModal
          filePath={filePath}
          fileName={fileName}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}
