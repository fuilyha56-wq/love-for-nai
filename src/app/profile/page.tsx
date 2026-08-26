"use client";

import { ArrowLeft, CalendarCheck, Copy, Save, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SessionExpiredNotice } from "@/app/session-notice";

type Profile = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  group: string;
  balance: number | null;
};
type Aff = { balance: number; checkedInToday: boolean; checkInReward: number };
type Referral = { link: string; invitedCount: number; registrationReward: number };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [saving, setSaving] = useState(false);
  const [aff, setAff] = useState<Aff | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [copyingReferral, setCopyingReferral] = useState(false);
  const referralInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.authenticated) {
          setExpired("登录状态已过期，请重新登录后查看个人资料");
          return;
        }
        setProfile(result.user);
        setUsername(result.user.username || "");
        setDisplayName(result.user.displayName || "");
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "读取个人资料失败"),
      );
    fetch("/api/wallet", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => setAff(result.aff || null))
      .catch(() => undefined);
    fetch("/api/aff/referral", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (result.link) setReferral(result);
      })
      .catch(() => undefined);
  }, []);

  async function checkIn() {
    setCheckingIn(true);
    setMessage("");
    try {
      const response = await fetch("/api/aff/check-in", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "签到失败");
      setAff((current) => ({
        balance: result.balance,
        checkedInToday: true,
        checkInReward: current?.checkInReward || 20,
      }));
      setMessage(result.reward ? `签到成功，获得 ${result.reward} AFF。` : "今日已签到。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "签到失败");
    } finally {
      setCheckingIn(false);
    }
  }

  async function copyReferral() {
    if (!referral) return;
    setCopyingReferral(true);
    try {
      await navigator.clipboard.writeText(referral.link);
      setMessage("邀请链接已复制。");
    } catch {
      referralInput.current?.select();
      const copied = document.execCommand("copy");
      setMessage(copied ? "邀请链接已复制。" : "邀请链接已选中，请手动复制。");
    } finally {
      setCopyingReferral(false);
    }
  }

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
      {expired && (
        <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-8">
          <SessionExpiredNotice message={expired} />
        </div>
      )}
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
            <div>
              <dt className="text-[var(--muted)]">LFN AFF</dt>
              <dd className="mt-1 font-semibold">{aff?.balance ?? "-"}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={checkIn}
            disabled={!profile || !aff || aff.checkedInToday || checkingIn}
            className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded bg-[#292d2c] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            <CalendarCheck size={15} />
            {checkingIn ? "签到中…" : aff?.checkedInToday ? "今日已签到" : "签到领取 20 AFF"}
          </button>
          <div className="mt-4 border-t border-[var(--line)] pt-4 text-xs">
            <p className="font-semibold">邀请好友</p>
            <p className="mt-1 leading-5 text-[var(--muted)]">
              好友通过链接完成注册可获得 {referral?.registrationReward ?? 100} AFF。已注册 {referral?.invitedCount ?? 0} 人。
            </p>
            <input
              ref={referralInput}
              aria-label="邀请注册链接"
              className="mt-3 h-9 w-full rounded border border-[var(--line)] bg-white px-2 text-[10px] text-[var(--muted)]"
              value={referral?.link || "正在生成邀请链接…"}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              onClick={copyReferral}
              disabled={!referral || copyingReferral}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold disabled:opacity-50"
            >
              <Copy size={14} /> {copyingReferral ? "复制中…" : "复制邀请链接"}
            </button>
          </div>
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
