"use client";

import {
  ArrowLeft,
  CalendarCheck,
  Coins,
  Copy,
  Images,
  Save,
  UserRound,
  WalletCards,
} from "lucide-react";
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
type NewApiWallet = { balance: number; used: number; group: string };
type Referral = {
  link: string;
  invitedCount: number;
  registrationReward: number;
};

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [saving, setSaving] = useState(false);
  const [aff, setAff] = useState<Aff | null>(null);
  const [newApi, setNewApi] = useState<NewApiWallet | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [copyingReferral, setCopyingReferral] = useState(false);
  const referralInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.authenticated) {
          setExpired("登录状态已过期，请重新登录后查看账号信息");
          return;
        }
        setProfile(result.user);
        setUsername(result.user.username || "");
        setDisplayName(result.user.displayName || "");
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "读取账号信息失败"),
      );
    fetch("/api/wallet", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (result.aff) setAff(result.aff);
        if (result.newApi) setNewApi(result.newApi);
      })
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
      setMessage(
        result.reward ? `签到成功，获得 ${result.reward} AFF。` : "今日已签到。",
      );
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
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa]/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3">
          <UserRound size={20} className="text-[var(--rose)]" />
          <b>我的账号</b>
          <span className="hidden text-xs text-[var(--muted)] sm:inline">
            资料 · 钱包 · 签到 · 邀请
          </span>
        </div>
        <Link href="/image" className="flex items-center gap-2 text-sm font-semibold">
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>
      {expired && (
        <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-8">
          <SessionExpiredNotice message={expired} />
        </div>
      )}
      <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
        {message && (
          <div className="rounded-md border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}

        {/* 概览：身份 + 双余额卡片 */}
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <article className="panel rounded-md p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#292d2c] text-white">
                <UserRound size={24} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">
                  {profile?.displayName || "读取中…"}
                </h1>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  @{profile?.username || "-"} · 分组 {profile?.group || "-"} · ID{" "}
                  {profile?.id ?? "-"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Link
                href="/history"
                className="feature-link h-8 flex-1 justify-center"
              >
                <Images size={13} /> 图片历史
              </Link>
              <Link
                href="/usage"
                className="feature-link h-8 flex-1 justify-center"
              >
                <WalletCards size={13} /> 使用记录
              </Link>
            </div>
          </article>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className="panel min-w-0 rounded-md p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                <Coins size={14} className="text-[var(--rose)]" /> NewAPI 余额
              </div>
              <strong
                className="mt-3 block max-w-full break-all text-xl leading-tight tabular-nums sm:text-2xl"
                title={newApi ? `$${newApi.balance.toFixed(2)}` : undefined}
              >
                {newApi ? `$${newApi.balance.toFixed(2)}` : "--"}
              </strong>
              <p className="mt-2 max-w-full break-words text-[11px] leading-4 text-[var(--muted)]">
                累计使用 {newApi ? `$${newApi.used.toFixed(2)}` : "--"}
                <br />
                AFF 不足时生成从此余额扣费
              </p>
            </article>
            <article className="panel min-w-0 rounded-md p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                <CalendarCheck size={14} className="text-[var(--rose)]" /> LFN AFF
              </div>
              <strong className="mt-3 block text-2xl tabular-nums">
                {aff ? aff.balance : "--"}
              </strong>
              <button
                type="button"
                onClick={checkIn}
                disabled={!profile || !aff || aff.checkedInToday || checkingIn}
                className="mt-3 h-9 w-full rounded bg-[#292d2c] text-xs font-semibold text-white disabled:opacity-50"
              >
                {checkingIn
                  ? "签到中…"
                  : aff?.checkedInToday
                    ? "今日已签到"
                    : `签到 +${aff?.checkInReward ?? 20} AFF`}
              </button>
            </article>
          </div>
        </div>

        {/* 资料 + 邀请 */}
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <form onSubmit={save} className="panel space-y-5 rounded-md p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              PROFILE · 个人资料
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-semibold" htmlFor="username">
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
                <label className="mb-2 block text-xs font-semibold" htmlFor="display-name">
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
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold">邮箱</label>
              <div className="field flex h-10 items-center px-3 text-sm text-[var(--muted)]">
                {profile?.email || "未公开"}
              </div>
            </div>
            <button
              type="submit"
              disabled={!profile || saving}
              className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-5 text-sm font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50"
            >
              <Save size={15} /> {saving ? "保存中…" : "保存资料"}
            </button>
          </form>

          <div className="panel rounded-md p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              REFERRAL · 邀请好友
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              好友通过链接注册，双方各得 {referral?.registrationReward ?? 100} AFF。
              已邀请 {referral?.invitedCount ?? 0} 人。
            </p>
            <input
              ref={referralInput}
              aria-label="邀请注册链接"
              className="field mt-3 h-9 w-full px-2 text-[10px] text-[var(--muted)]"
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
        </div>
      </section>
    </main>
  );
}
