"use client";

import { ArrowLeft, Save, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Profile = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  group: string;
  balance: number | null;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.authenticated)
          throw new Error("请先登录后查看个人资料");
        setProfile(result.user);
        setUsername(result.user.username || "");
        setDisplayName(result.user.displayName || "");
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "读取个人资料失败"),
      );
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "保存失败");
      setMessage("个人资料已更新。重新登录后，页头名称也会同步更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <UserRound size={20} className="text-[var(--rose)]" />
          <b>个人资料</b>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>
      <section className="mx-auto grid max-w-4xl gap-6 p-4 sm:p-8 md:grid-cols-[240px_1fr]">
        <aside className="border-r border-[var(--line)] pr-6">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-[#292d2c] text-white">
            <UserRound size={27} />
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            {profile?.displayName || "读取中…"}
          </h1>
          <dl className="mt-5 space-y-3 text-xs">
            <div>
              <dt className="text-[var(--muted)]">用户 ID</dt>
              <dd className="mt-1 font-semibold">{profile?.id ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">分组</dt>
              <dd className="mt-1 font-semibold">{profile?.group || "-"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">NewAPI 余额</dt>
              <dd className="mt-1 font-semibold">
                {profile?.balance == null ? "-" : profile.balance.toFixed(2)}
              </dd>
            </div>
          </dl>
        </aside>
        <form onSubmit={save} className="space-y-5">
          <div>
            <label
              className="mb-2 block text-xs font-semibold"
              htmlFor="username"
            >
              用户名
            </label>
            <input
              id="username"
              className="field w-full px-3"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={!profile}
            />
          </div>
          <div>
            <label
              className="mb-2 block text-xs font-semibold"
              htmlFor="display-name"
            >
              显示名称
            </label>
            <input
              id="display-name"
              className="field w-full px-3"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={!profile}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold">邮箱</label>
            <div className="field flex items-center px-3 text-sm text-[var(--muted)]">
              {profile?.email || "未公开"}
            </div>
          </div>
          {message && (
            <p className="rounded border border-[var(--line)] bg-white p-3 text-sm">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={!profile || saving}
            className="flex h-11 items-center gap-2 rounded bg-[var(--rose)] px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "保存中…" : "保存资料"}
          </button>
        </form>
      </section>
    </main>
  );
}
