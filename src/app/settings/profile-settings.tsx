"use client";

import Link from "next/link";
import { Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

type Profile = { id: number; username: string; displayName: string; email: string; group: string };

export default function ProfileSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json() as { authenticated?: boolean; user?: Profile; message?: string };
      if (!response.ok || !result.authenticated || !result.user) throw new Error(result.message || "请先登录后管理个人资料。");
      setProfile(result.user);
      setUsername(result.user.username);
      setDisplayName(result.user.displayName);
    }).catch((error) => {
      if (error instanceof Error && error.name !== "AbortError") setMessage(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/me", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), displayName: displayName.trim() }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "个人资料保存失败。");
      setProfile((current) => current ? { ...current, username: username.trim(), displayName: displayName.trim() } : current);
      setMessage("个人资料已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "个人资料保存失败。"); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <article className="panel rounded-md p-5 sm:p-6">
      <h3 className="flex items-center gap-2 font-semibold"><UserRound size={18} className="text-[var(--rose)]" /> 个人资料</h3>
      <p className="mt-2 text-xs leading-6 text-[var(--muted)]">修改账号在站点中的名称；余额、签到、邀请及图包在个人页面查看。</p>
      {loading ? <p role="status" className="mt-5 text-sm text-[var(--muted)]">正在读取个人资料…</p> : profile ? <form onSubmit={save} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold">用户名<input className="field mt-2 w-full px-3" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.\-]{3,32}" autoComplete="username" /></label>
          <label className="block text-xs font-semibold">显示名称<input className="field mt-2 w-full px-3" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={40} autoComplete="nickname" /></label>
        </div>
        <p className="text-xs text-[var(--muted)]">账号 ID {profile.id} · 分组 {profile.group} {profile.email && `· ${profile.email}`}</p>
        <button type="submit" disabled={saving} className="settings-primary-button"><Save size={15} /> {saving ? "正在保存…" : "保存资料"}</button>
      </form> : <Link href="/sign-in" className="settings-primary-button mt-5">前往登录</Link>}
      {message && <p role="status" className="mt-4 text-sm text-[var(--muted)]">{message}</p>}
    </article>
    <article className="panel rounded-md p-5 sm:p-6">
      <h3 className="font-semibold">个人页面与创作额度</h3>
      <p className="mt-2 text-xs leading-6 text-[var(--muted)]">查看 NewAPI 余额、LFN AFF、签到奖励、图包和邀请记录。</p>
      <Link href="/account" className="settings-secondary-button mt-4">打开个人页面</Link>
    </article>
  </div>;
}
