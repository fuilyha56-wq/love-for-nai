"use client";

// VSCode 内联聊天的 LFN 版：选中文本→右键菜单（1_chat 组语义）→
// 锚定在文本域下方的对话框，Keep 用结果替换所选内容。
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Languages,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  SpellCheck,
  Square,
  WandSparkles,
  X,
} from "lucide-react";

export type InlineChatTarget = {
  kind: "prompt" | "negative" | "character" | "characterNegative";
  label: string;
  characterId?: string;
};

export type InlineChatSelection = { start: number; end: number; text: string };

export type InlineChatSession = {
  target: InlineChatTarget;
  anchor: { top: number; left: number; width: number };
  selection: InlineChatSelection;
  contextBefore: string;
  contextAfter: string;
  mode: "ask" | "polish" | "fix" | "translate";
  // 挂载即自动发送（VSCode Fix 的 autoSend 语义）。
  autoSend: boolean;
};

export type InlineChatMenuItem = {
  id: InlineChatSession["mode"];
  label: string;
  description: string;
  icon: React.ReactNode;
  autoSend: boolean;
};

// 对齐 VSCode 右键菜单 1_chat 组：Ask/修复等，其余为 LFN 语义扩展。
export const INLINE_CHAT_MENU_ITEMS: InlineChatMenuItem[] = [
  {
    id: "ask",
    label: "询问 AI",
    description: "对所选内容提问或下达指令",
    icon: <Sparkles size={14} />,
    autoSend: false,
  },
  {
    id: "polish",
    label: "AI 润色",
    description: "润色所选内容，保持原意",
    icon: <WandSparkles size={14} />,
    autoSend: true,
  },
  {
    id: "fix",
    label: "修复",
    description: "修复所选内容中的错误",
    icon: <SpellCheck size={14} />,
    autoSend: true,
  },
  {
    id: "translate",
    label: "翻译成英文",
    description: "中英互译所选内容",
    icon: <Languages size={14} />,
    autoSend: true,
  },
];

const MODE_LABELS: Record<InlineChatSession["mode"], string> = {
  ask: "询问 AI",
  polish: "AI 润色",
  fix: "修复",
  translate: "翻译成英文",
};

export function InlineChatMenu({
  position,
  targetLabel,
  onPick,
  onClose,
}: {
  position: { x: number; y: number };
  targetLabel: string;
  onPick: (item: InlineChatMenuItem) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div
        className="inline-chat-menu-backdrop"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="inline-chat-menu"
        role="menu"
        aria-label={`AI 操作 · ${targetLabel}`}
        style={{
          left: Math.min(position.x, window.innerWidth - 250),
          top: Math.min(position.y, window.innerHeight - 230),
        }}
      >
        {INLINE_CHAT_MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="inline-chat-menu-item"
            onClick={() => onPick(item)}
          >
            {item.icon}
            <span className="min-w-0">
              <b>{item.label}</b>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function InlineChatZone({
  session,
  model,
  onKeep,
  onClose,
}: {
  session: InlineChatSession;
  model: string;
  onKeep: (text: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (session.autoSend) run(session.mode, "");
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // 仅在会话打开时执行一次；函数声明已提升，可直接引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function run(mode: InlineChatSession["mode"], instruction: string) {
    if (running) return;
    setRunning(true);
    setError("");
    setResult(null);
    void (async () => {
      try {
        const response = await fetch("/api/assistant/inline-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            mode,
            instruction,
            selection: session.selection.text,
            contextBefore: session.contextBefore,
            contextAfter: session.contextAfter,
          }),
        });
        const created = (await response.json()) as {
          jobId?: string;
          message?: string;
        };
        if (!response.ok || !created.jobId)
          throw new Error(created.message || "内联聊天启动失败");
        const deadline = Date.now() + 90_000;
        pollRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const poll = await fetch(
                `/api/assistant/inline-chat?job=${encodeURIComponent(created.jobId!)}`,
                { cache: "no-store" },
              );
              const data = (await poll.json()) as {
                status?: string;
                text?: string;
                message?: string;
              };
              if (data.status === "done") {
                stopPolling();
                setResult(data.text || "");
                setRunning(false);
              } else if (data.status === "error") {
                stopPolling();
                setError(data.message || "处理失败");
                setRunning(false);
              } else if (Date.now() > deadline) {
                stopPolling();
                setError("处理超时，请重试");
                setRunning(false);
              }
            } catch {
              // 轮询单次失败静默重试，超时兜底。
            }
          })();
        }, 1000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "内联聊天启动失败");
        setRunning(false);
      }
    })();
  }

  return (
    <div
      className={`inline-chat-zone${running ? " is-busy" : ""}`}
      role="dialog"
      aria-label={`内联聊天 · ${session.target.label}`}
      style={{
        top: session.anchor.top,
        left: session.anchor.left,
        width: session.anchor.width,
      }}
    >
      <div className="inline-chat-input-row">
        <textarea
          ref={inputRef}
          className="inline-chat-input"
          rows={1}
          value={input}
          placeholder="输入指令（Enter 发送，Shift+Enter 换行）"
          aria-label="内联聊天输入"
          onChange={(event) => {
            setInput(event.target.value);
            const el = event.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(72, el.scrollHeight)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              run("ask", input);
            }
          }}
        />
        <button
          type="button"
          className="inline-chat-send"
          data-label={running ? "停止" : "发送"}
          aria-label={running ? "停止处理" : "发送指令"}
          onClick={() => {
            if (running) {
              stopPolling();
              setRunning(false);
              setError("");
              return;
            }
            run("ask", input);
          }}
        >
          {running ? <Square size={12} /> : <SendHorizontal size={13} />}
        </button>
      </div>
      {(result !== null || error) && (
        <div
          className={`inline-chat-result${error ? " has-error" : ""}`}
          role={error ? "alert" : undefined}
        >
          {error || result}
        </div>
      )}
      <div className="inline-chat-status">
        <span className="inline-chat-status-label">
          {running ? "处理中…" : MODE_LABELS[session.mode]} ·{" "}
          {session.target.label} · 所选 {session.selection.text.length} 字
        </span>
        <span className="inline-chat-status-actions">
          <button
            type="button"
            className="is-primary"
            disabled={!result || running}
            data-label="用结果替换所选内容"
            onClick={() => {
              if (result !== null && !running) {
                onKeep(result);
                onClose();
              }
            }}
          >
            <Check size={13} />
            保留
          </button>
          <button
            type="button"
            disabled={running}
            data-label="重新生成"
            onClick={() => run(session.mode, input)}
          >
            <RotateCcw size={13} />
            重试
          </button>
          <button
            type="button"
            data-label="关闭（Esc）"
            onClick={() => {
              stopPolling();
              onClose();
            }}
          >
            <X size={13} />
            关闭
          </button>
        </span>
      </div>
    </div>
  );
}
