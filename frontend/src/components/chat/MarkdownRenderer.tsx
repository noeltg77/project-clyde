"use client";

import { useState, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/* ─── Copy button for code blocks ───────────────────────────────── */

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — some browsers restrict clipboard
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 text-[11px] font-mono rounded-[2px] border border-border bg-bg-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors"
      aria-label="Copy code"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ─── Custom code block renderer ────────────────────────────────── */

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
};

function CodeBlock({ children, className, ...rest }: CodeProps) {
  // Detect fenced blocks: react-markdown wraps them in <pre><code className="language-xxx">
  const isBlock = className?.startsWith("language-") || className?.startsWith("hljs");

  if (!isBlock) {
    // Inline code
    return (
      <code
        className="bg-bg-tertiary px-1.5 py-0.5 rounded-[2px] font-mono text-[13px] text-accent-primary border border-border/40"
        {...rest}
      >
        {children}
      </code>
    );
  }

  // Extract raw text for the copy button
  const raw = extractText(children);

  // Pull language label from className (e.g. "language-typescript hljs" → "typescript")
  const lang = className
    ?.split(/\s+/)
    .find((c) => c.startsWith("language-"))
    ?.replace("language-", "");

  return (
    <div className="relative group my-3">
      {/* Language label + copy button bar */}
      <div className="flex items-center justify-between bg-[#111] border border-border border-b-0 rounded-t-[2px] px-3 py-1.5">
        <span className="text-[11px] font-mono text-text-secondary uppercase tracking-wider">
          {lang || "code"}
        </span>
        <CopyButton code={raw} />
      </div>
      <pre className="!mt-0 !rounded-t-none bg-bg-tertiary border border-border rounded-b-[2px] overflow-x-auto px-4 py-3 text-[13px] leading-relaxed">
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/* ─── Extract plain text from React children ────────────────────── */

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractText(el.props.children);
  }
  return "";
}

/* ─── Custom pre wrapper (prevents double nesting) ──────────────── */

function PreBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  // The CodeBlock component already handles the <pre> wrapper,
  // so we just pass children through to avoid double <pre>
  return <>{children}</>;
}

/* ─── Table components ──────────────────────────────────────────── */

function Table({ children }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="overflow-x-auto my-3 border border-border rounded-[2px]">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Thead({ children }: ComponentPropsWithoutRef<"thead">) {
  return <thead className="bg-bg-tertiary border-b border-border">{children}</thead>;
}

function Th({ children }: ComponentPropsWithoutRef<"th">) {
  return (
    <th className="text-left px-3 py-2 text-[12px] font-semibold text-accent-primary uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ children }: ComponentPropsWithoutRef<"td">) {
  return (
    <td className="px-3 py-2 text-text-primary border-t border-border/50">
      {children}
    </td>
  );
}

/* ─── Blockquote ────────────────────────────────────────────────── */

function Blockquote({ children }: ComponentPropsWithoutRef<"blockquote">) {
  return (
    <blockquote className="border-l-2 border-accent-primary/60 pl-4 my-3 text-text-secondary italic">
      {children}
    </blockquote>
  );
}

/* ─── Horizontal rule ───────────────────────────────────────────── */

function Hr() {
  return <hr className="border-border my-4" />;
}

/* ─── Links ─────────────────────────────────────────────────────── */

function Anchor({ children, href, ...rest }: ComponentPropsWithoutRef<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-primary underline underline-offset-2 decoration-accent-primary/40 hover:decoration-accent-primary transition-colors"
      {...rest}
    >
      {children}
    </a>
  );
}

/* ─── Task list items (GFM checkboxes) ──────────────────────────── */

function ListItem({ children, ...rest }: ComponentPropsWithoutRef<"li">) {
  // Detect checkbox task list items
  const childArray = Array.isArray(children) ? children : [children];
  const firstChild = childArray[0];

  type CheckboxProps = { type?: string; checked?: boolean };

  if (
    firstChild &&
    typeof firstChild === "object" &&
    "props" in firstChild &&
    (firstChild as React.ReactElement<CheckboxProps>).props?.type === "checkbox"
  ) {
    const checked = (firstChild as React.ReactElement<CheckboxProps>).props?.checked;
    return (
      <li className="flex items-start gap-2 list-none" {...rest}>
        <span
          className={`mt-0.5 inline-block w-4 h-4 rounded-[2px] border ${
            checked
              ? "bg-accent-primary border-accent-primary text-bg-primary"
              : "border-border bg-bg-tertiary"
          } flex items-center justify-center text-[10px] leading-none`}
        >
          {checked && "✓"}
        </span>
        <span className={checked ? "line-through text-text-secondary" : ""}>
          {childArray.slice(1)}
        </span>
      </li>
    );
  }

  return <li {...rest}>{children}</li>;
}

/* ─── Main MarkdownRenderer ─────────────────────────────────────── */

type MarkdownRendererProps = {
  content: string;
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body prose prose-sm prose-invert max-w-none text-text-primary [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_h1]:text-lg [&_h1]:font-display [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-display [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-display [&_h3]:font-semibold [&_h3]:text-accent-primary [&_h3]:mt-3 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-text-secondary [&_h4]:mt-2 [&_h4]:mb-1 [&_strong]:text-text-primary [&_strong]:font-semibold [&_em]:text-text-secondary [&_del]:text-text-secondary/60 [&_del]:line-through [&_img]:rounded-[2px] [&_img]:border [&_img]:border-border">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock as never,
          pre: PreBlock,
          table: Table,
          thead: Thead,
          th: Th,
          td: Td,
          blockquote: Blockquote,
          hr: Hr,
          a: Anchor,
          li: ListItem,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
