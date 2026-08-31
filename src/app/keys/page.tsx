"use client";

import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type TokenItem = {
  id: number;
  name: string;
  status: number;
  created_time?: number;
  used_quota?: number;
  unlimited_quota?: boolean;
};

// navigator.clipboard 仅在 HTTPS 或 localhost 下存在，需要逐级降级。
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒时继续尝试兜底方案。
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}
export default function KeysPage() {
  const [items, setItems] = useState<TokenItem[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  const [working, setWorking] = useState(false);
  const [revealed, setRevealed] = useState<{ id: number; key: string } | null>(
    null,
  );
  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const result = await readJson<{ items?: TokenItem[] }>(
        response,
        "读取密钥失败",
      );
      setItems(result.items || []);
      setLoadState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取密钥失败";
      setLoadError(nextError);
      setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建失败");
      setName("");
      await load();
      setMessage("API 密钥已创建。可在 NewAPI 中查看和复制完整密钥。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setWorking(false);
    }
  }
  async function toggle(item: TokenItem) {
    setWorking(true);
    try {
      const response = await fetch("/api/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          status: item.status === 1 ? 2 : 1,
          statusOnly: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "更新失败");
      await load();
      setMessage(item.status === 1 ? "密钥已停用。" : "密钥已启用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
    } finally {
      setWorking(false);
    }
  }
  async function copyKey(item: TokenItem) {
    setWorking(true);
    try {
      const response = await fetch(`/api/keys/${item.id}/key`, {
        method: "POST",
      });
      const result = await readJson<{ key: string }>(response, "复制失败");
      if (await writeClipboard(result.key)) {
        setRevealed(null);
        setMessage(`已复制密钥“${item.name}”到剪贴板。`);
      } else {
        // 纯 HTTP 页面没有剪贴板权限，退化为展示明文供手动复制。
        setRevealed({ id: item.id, key: result.key });
        setMessage(`浏览器未授予剪贴板权限，请手动复制下方密钥。`);
      }
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "复制失败");
    } finally {
      setWorking(false);
    }
  }
  async function remove(item: TokenItem) {
    if (!window.confirm(`确认删除密钥“${item.name}”？`)) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/keys?id=${item.id}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setWorking(false);
    }
  }
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <KeyRound size={20} className="text-[var(--rose)]" />
          <b>API 密钥</b>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-5xl p-4 sm:p-8">
        <form onSubmit={create} className="flex gap-2">
          <input
            className="field min-w-0 flex-1 px-3"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入新密钥名称"
            aria-label="新密钥名称"
          />
          <button
            disabled={working}
            className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus size={16} />
            创建密钥
          </button>
        </form>
        <p className="mt-2 text-xs text-[var(--muted)]">
          LFN 不保存或展示密钥明文。使用任意有效密钥访问 LFN 图像端点，会自动按图包 → 个人 AFF → NewAPI 余额扣费，无需绑定。
        </p>
        {expired && (
          <div className="my-4">
            <SessionExpiredNotice message={expired} />
          </div>
        )}
        {message && (
          <div className="my-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}
        <div className="mt-5 space-y-2">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-white p-3"
            >
              <div>
                <b className="text-sm">{item.name}</b>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  ID {item.id} · {item.status === 1 ? "已启用" : "已停用"}
                </p>
              </div>
              {revealed?.id === item.id && (
                <input
                  className="field order-last w-full px-3 font-mono text-xs"
                  value={revealed.key}
                  readOnly
                  aria-label="密钥明文"
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => copyKey(item)}
                  disabled={working}
                  className="key-action"
                  title="复制密钥"
                  aria-label="复制密钥"
                >
                  <Copy size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  disabled={working}
                  className={`key-action ${item.status === 1 ? "" : "opacity-50"}`}
                  title={item.status === 1 ? "停用密钥" : "启用密钥"}
                  aria-label={item.status === 1 ? "停用密钥" : "启用密钥"}
                >
                  <Power size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  disabled={working}
                  className="key-action text-[var(--rose)]"
                  title="删除密钥"
                  aria-label="删除密钥"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!items.length && loadState === "loading" && (
          <p className="py-16 text-center text-sm text-[var(--muted)]">
            正在读取 API 密钥…
          </p>
        )}
        {!items.length && loadState === "error" && (
          <div className="my-5 rounded border border-[#e4c991] bg-[#fff8e8] p-4 text-center text-sm text-[#77531e]">
            <p>{loadError || "读取密钥失败"}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
            >
              重试
            </button>
          </div>
        )}
        {!items.length && loadState === "loaded" && !message && !expired && (
          <p className="py-16 text-center text-sm text-[var(--muted)]">
            暂无 API 密钥。创建一个密钥即可开始使用。
          </p>
        )}
      </section>
    </main>
  );
}
