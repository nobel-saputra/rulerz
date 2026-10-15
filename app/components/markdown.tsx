"use client";

import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={() => {
            const text = preRef.current?.innerText || "";
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre({ node, children }) {
    const code = node?.children[0];
    const cls =
      code?.type === "element" && Array.isArray(code.properties.className)
        ? (code.properties.className as string[])
        : [];
    const lang = cls.find((c) => c.startsWith("language-"))?.slice(9) || "";
    return <CodeBlock lang={lang}>{children}</CodeBlock>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
