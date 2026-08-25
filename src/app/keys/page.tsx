"use client";

import { ArrowLeft, KeyRound, Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
export default function KeysPage() {
  const [items, setItems] = useState<TokenItem[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [working, setWorking] = useState(false);
  async function load() {
    const response = await fetch("/api/keys", { cache: "no-store" });
    const result = await readJson<{ items?: TokenItem[] }>(
      response,
      "读取密钥失败",
    );
    setItems(result.items || []);
  }
  useEffect(() => {
    let active = true;
    async function loadInitial() {
      try {
        const response = await fetch("/api/keys", { cache: "no-store" });
        const result = await readJson<{ items?: TokenItem[] }>(
          response,
          "读取密钥失败",
        );
        if (active) setItems(result.items || []);
      } catch (error) {
        if (!active) return;
        if (error instanceof SessionExpiredError) setExpired(error.message);
        else
          setMessage(error instanceof Error ? error.message : "读取密钥失败");
      }
    }
    void loadInitial();
    return () => {
      active = false;
    };
  }, []);
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
        body: JSON.stringify({ ...item, status: item.status === 1 ? 2 : 1 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "更新失败");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
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
          LFN 不保存或展示密钥明文。创建的密钥与 NewAPI 互通。
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
              className="flex items-center justify-between rounded-md border border-[var(--line)] bg-white p-3"
            >
              <div>
                <b className="text-sm">{item.name}</b>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  ID {item.id} · {item.status === 1 ? "已启用" : "已停用"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  disabled={working}
                  className="key-action"
                  title={item.status === 1 ? "停用密钥" : "启用密钥"}
                >
                  <Power size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  disabled={working}
                  className="key-action text-[var(--rose)]"
                  title="删除密钥"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!items.length && !message && (
          <p className="py-16 text-center text-sm text-[var(--muted)]">
            正在读取 API 密钥…
          </p>
        )}
      </section>
    </main>
  );
}
