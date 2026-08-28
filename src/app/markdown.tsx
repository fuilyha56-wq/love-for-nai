"use client";

import React from "react";

function isSafeHref(value: string): boolean {
  const href = value.trim();
  if (href.startsWith("/") || href.startsWith("#") || href.startsWith("?")) return true;
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

// 轻量 Markdown 渲染：标题 / 段落 / 表格 / 代码块 / 行内代码 /
// 列表 / 粗体 / 链接。内容全部经 React 转义，无 dangerouslySetInnerHTML。
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 先按行内代码切分，代码外的片段再做粗体和链接。
  const segments = text.split(/(`[^`]+`)/g);
  segments.forEach((segment, index) => {
    if (segment.startsWith("`") && segment.endsWith("`") && segment.length > 2) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded bg-[#f1eee7] px-1.5 py-0.5 font-mono text-[0.85em]"
        >
          {segment.slice(1, -1)}
        </code>,
      );
      return;
    }
    // 粗体 **text** 与链接 [label](url)。
    const parts = segment.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
    parts.forEach((part, partIndex) => {
      if (!part) return;
      const key = `${keyPrefix}-t-${index}-${partIndex}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        nodes.push(
          <strong key={key} className="font-semibold">
            {part.slice(2, -2)}
          </strong>,
        );
      } else {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link && isSafeHref(link[2])) {
          nodes.push(
            <a
              key={key}
              href={link[2]}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--rose)] underline underline-offset-2"
            >
              {link[1]}
            </a>,
          );
        } else {
          nodes.push(React.createElement(React.Fragment, { key }, part));
        }
      }
    });
  });
  return nodes;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "divider" };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    // 围栏代码块。
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // 跳过收尾围栏。
      blocks.push({ kind: "code", lines: code });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: "divider" });
      index += 1;
      continue;
    }
    // 表格：| a | b | 后跟 | --- | --- |。
    if (line.trim().startsWith("|") && lines[index + 1]?.includes("---")) {
      const header = line.split("|").slice(1, -1).map((cell) => cell.trim());
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(
          lines[index].split("|").slice(1, -1).map((cell) => cell.trim()),
        );
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    // 列表：- item / 1. item。
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet || ordered) {
      const items: string[] = [];
      const isOrdered = Boolean(ordered);
      while (index < lines.length) {
        const current = lines[index];
        const m = isOrdered
          ? current.match(/^\s*\d+\.\s+(.*)$/)
          : current.match(/^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }
    // 普通段落：收集到空行为止。
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

export function MarkdownView({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="space-y-3 text-sm leading-6 text-[var(--ink)]">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.kind) {
          case "heading": {
            const sizes = ["text-xl", "text-lg", "text-base", "text-sm"];
            return (
              <h3
                key={key}
                className={`${sizes[block.level - 1]} font-[var(--font-display)] font-bold`}
              >
                {renderInline(block.text, key)}
              </h3>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="whitespace-pre-wrap">
                {renderInline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-md border border-[var(--line)] bg-[#292d2c] p-3 font-mono text-xs leading-5 text-[#e8e6e1]"
              >
                {block.lines.join("\n")}
              </pre>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={key}
                className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b-2 border-[var(--line)] text-left">
                      {block.header.map((cell, cellIndex) => (
                        <th key={`${key}-h-${cellIndex}`} className="px-2 py-1.5 font-semibold">
                          {renderInline(cell, `${key}-h-${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r-${rowIndex}`} className="border-b border-[var(--line)]">
                        {row.map((cell, cellIndex) => (
                          <td key={`${key}-r-${rowIndex}-${cellIndex}`} className="px-2 py-1.5 align-top">
                            {renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "divider":
            return <hr key={key} className="border-[var(--line)]" />;
        }
      })}
    </div>
  );
}
