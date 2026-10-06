"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, Copy, Coins, Images, LockKeyhole, Package, Save, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "./profile.css";
import "../account/account.css";
import { PROFILE_SECTION_IDS, profileSectionForHash } from "@/lib/profile-navigation";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type Profile = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  group: string;
  balance: number | null;
};
type Aff = {
  balance: number;
  packageBalance: number;
  totalBalance: number;
  packageRateLimitRemaining: number;
  checkedInToday: boolean;
  checkInEnabled: boolean;
  checkInReward: number;
};
type NewApiWallet = { balance: number; used: number; group: string };
type ImagePackage = { priceUsd: number; affPerPackage: number; rateLimit: number; purchaseEnabled: boolean };
type WalletCapabilities = { wallet: { upstreamBalance: boolean }; labels: { upstreamBalance: string; credits: string; packages: string }; image?: { label: string } };
type Referral = {
  enabled: boolean;
  link: string | null;
  invitedCount?: number;
  registrationReward: number;
};
type LedgerTransaction = {
  id: string;
  createdAt: string;
  amount: number;
  type: string;
  description: string;
  source?: string;
};
type Ledger = { transactions: LedgerTransaction[] };
const formatDollars = (value: number): string =>
  `$${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;

function browserUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [saving, setSaving] = useState(false);
  const [aff, setAff] = useState<Aff | null>(null);
  const [newApi, setNewApi] = useState<NewApiWallet | null>(null);
  const [imagePackage, setImagePackage] = useState<ImagePackage | null>(null);
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
  const [packageCount, setPackageCount] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [copyingReferral, setCopyingReferral] = useState(false);
  const [profileState, setProfileState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [profileError, setProfileError] = useState("");
  const [walletState, setWalletState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [walletError, setWalletError] = useState("");
  const [referralState, setReferralState] = useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [referralError, setReferralError] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerMonth, setLedgerMonth] = useState(() => new Date());
  const [activeSection, setActiveSection] = useState("profile-rewards");
  const referralInput = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    setProfileState("loading");
    setProfileError("");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.authenticated) {
        setExpired("登录状态已过期，请重新登录后查看个人资料");
        setProfileState("error");
        return;
      }
      setProfile(result.user);
      setUsername(result.user.username || "");
      setDisplayName(result.user.displayName || "");
      setProfileState("loaded");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "读取个人资料失败";
      setProfileError(nextError);
      setMessage(nextError);
      setProfileState("error");
    }
  }, []);
  const loadWallet = useCallback(async () => {
    setWalletState("loading");
    setWalletError("");
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      const result = await readJson<{ aff?: Aff; newApi?: NewApiWallet; imagePackage?: ImagePackage; capabilities?: WalletCapabilities }>(response, "读取钱包失败");
      setAff(result.aff || null);
      setNewApi(result.newApi || null);
      setImagePackage(result.imagePackage || null);
      setCapabilities(result.capabilities || null);
      setWalletState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取钱包失败";
      setWalletError(nextError);
      setMessage(nextError);
      setWalletState("error");
    }
  }, []);

  const maxAffordablePackages = imagePackage && newApi ? Math.min(10, Math.max(0, Math.floor(newApi.balance / imagePackage.priceUsd))) : 0;

  async function purchasePackages() {
    if (!imagePackage?.purchaseEnabled || purchasing) return;
    if (maxAffordablePackages < 1 || packageCount > maxAffordablePackages) {
      setMessage(maxAffordablePackages < 1 ? "NewAPI 余额不足，无法购买图包。" : `当前余额最多购买 ${maxAffordablePackages} 包图包。`);
      return;
    }
    const price = imagePackage.priceUsd * packageCount;
    const affAmount = imagePackage.affPerPackage * packageCount;
    if (!window.confirm(`确认使用 $${price.toFixed(2)} NewAPI 余额购买 ${packageCount} 包图包，获得 ${affAmount} 图包 AFF？`)) return;
    setPurchasing(true);
    setMessage("");
    try {
      const response = await fetch("/api/image-packages/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: browserUuid(), packageCount }) });
      const result = await readJson<{ packageBalance?: number }>(response, "图包购买失败");
      await loadWallet();
      setMessage(result.packageBalance != null ? `购买成功，图包额度现为 ${result.packageBalance} AFF。` : `购买成功，获得 ${affAmount} 图包 AFF。`);
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "图包购买失败");
    } finally { setPurchasing(false); }
  }
  const loadLedger = useCallback(async () => {
    try {
      const response = await fetch("/api/aff/ledger", { cache: "no-store" });
      const result = await readJson<Ledger>(response, "读取奖励流水失败");
      setLedger(result);
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
    }
  }, []);
  const loadReferral = useCallback(async () => {
    setReferralState("loading");
    setReferralError("");
    try {
      const response = await fetch("/api/aff/referral", { cache: "no-store" });
      const result = await readJson<Referral>(response, "读取邀请链接失败");
      if (result.enabled && !result.link) throw new Error("邀请链接暂不可用");
      setReferral(result);
      setReferralState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取邀请链接失败";
      setReferralError(nextError);
      setReferralState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      loadProfile();
      loadWallet();
      loadReferral();
      loadLedger();
    });
  }, [loadLedger, loadProfile, loadReferral, loadWallet]);

  useEffect(() => {
    const updateFromHash = () => {
      setActiveSection(profileSectionForHash(window.location.hash));
    };
    updateFromHash();
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-104px 0px -58%", threshold: [0.1, 0.35, 0.7] });
    PROFILE_SECTION_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    window.addEventListener("hashchange", updateFromHash);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, []);

  async function checkIn() {
    if (!aff?.checkInEnabled) return;
    setCheckingIn(true);
    setMessage("");
    try {
      const response = await fetch("/api/aff/check-in", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "签到失败");
      setAff((current) => ({
        balance: result.balance,
        packageBalance: result.packageBalance ?? current?.packageBalance ?? 0,
        totalBalance:
          result.totalBalance ??
          result.balance + (result.packageBalance ?? current?.packageBalance ?? 0),
        packageRateLimitRemaining: current?.packageRateLimitRemaining ?? 10,
        checkedInToday: result.checkedInToday ?? true,
        checkInEnabled: result.checkInEnabled ?? current?.checkInEnabled ?? false,
        checkInReward: current?.checkInReward ?? result.reward ?? 0,
      }));
      setMessage(result.reward ? `签到成功，获得 ${result.reward} AFF。` : "今日已签到。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "签到失败");
    } finally {
      setCheckingIn(false);
    }
  }

  async function copyReferral() {
    if (!referral?.enabled || !referral.link) return;
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

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    setPasswordSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "密码修改失败");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(result.message || "密码已更新，所有设备已退出，请重新登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setPasswordSaving(false);
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

  const monthStart = new Date(ledgerMonth.getFullYear(), ledgerMonth.getMonth(), 1);
  const monthDays = new Date(ledgerMonth.getFullYear(), ledgerMonth.getMonth() + 1, 0).getDate();
  const monthOffset = (monthStart.getDay() + 6) % 7;
  const checkInDays = new Set((ledger?.transactions || [])
    .filter((item) => item.type === "check-in")
    .map((item) => new Date(item.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })));
  const monthKey = `${ledgerMonth.getFullYear()}-${String(ledgerMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthCheckIns = [...checkInDays].filter((day) => day.startsWith(monthKey)).length;
  const totalCheckIns = (ledger?.transactions || []).filter((item) => item.type === "check-in").length;
  const totalCheckInReward = (ledger?.transactions || []).filter((item) => item.type === "check-in").reduce((sum, item) => sum + Math.max(0, item.amount), 0);

  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="profile-page-header flex h-14 items-center justify-between border-b border-[var(--line)] px-4 sm:px-7">
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
      <WorkspaceNav />
      {expired && (
        <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-8">
          <SessionExpiredNotice message={expired} />
        </div>
      )}
      <section className="profile-layout">
        <aside className="profile-sidebar">
          <div className="profile-avatar">
            <UserRound size={27} />
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            {profileState === "loading"
              ? "读取中…"
              : profile?.displayName || "个人资料暂不可用"}
          </h1>
          {profileState === "error" && !expired && (
            <div className="mt-3 rounded border border-[#e4c991] bg-[#fff8e8] p-2 text-xs text-[#77531e]">
              <p>{profileError || "读取个人资料失败"}</p>
              <button
                type="button"
                onClick={() => void loadProfile()}
                className="mt-2 h-7 rounded bg-[var(--rose)] px-2.5 text-[11px] font-semibold text-white"
              >
                重试
              </button>
            </div>
          )}
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
                {profile?.balance == null ? "-" : formatDollars(profile.balance)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">LFN AFF</dt>
              <dd className="mt-1 font-semibold">
                {walletState === "loading"
                  ? "读取中…"
                  : aff
                    ? `${aff.balance} + ${aff.packageBalance}`
                    : "暂无 AFF 数据"}
              </dd>
            </div>
          </dl>
          {walletState === "error" && (
            <div className="profile-login-notice">
              <p>{walletError || "读取钱包失败"}</p>
              <button type="button" onClick={() => void loadWallet()} className="settings-secondary-button">重试</button>
            </div>
          )}
          <a href="#profile-wallet" className="profile-account-link"><WalletCards size={14} /> 钱包与创作额度</a>
          <nav className="profile-sidebar-nav" aria-label="个人资料分区">
            <a href="#profile-rewards" aria-current={activeSection === "profile-rewards" ? "location" : undefined}>奖励与流水</a>
            <a href="#profile-info" aria-current={activeSection === "profile-info" ? "location" : undefined}>资料信息</a>
            <a href="#profile-security" aria-current={activeSection === "profile-security" ? "location" : undefined}>密码与安全</a>
          </nav>
        </aside>
        <div className="profile-content">
        <div id="profile-rewards" className="profile-section">
          <section className="profile-card profile-checkin-card" aria-labelledby="checkin-heading">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--rose)]"><CalendarCheck size={16} /></span><div><h2 id="checkin-heading" className="text-base font-semibold">每日签到</h2><p className="mt-1 text-xs text-[var(--muted)]">每个中国标准时间日可签到一次，奖励直接进入个人 AFF。</p></div></div>
            <div className="profile-checkin-calendar"><div className="mt-3 flex items-center justify-between"><button type="button" className="grid h-7 w-7 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-muted)]" aria-label="上个月" onClick={() => setLedgerMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={15} /></button><span className="text-sm font-semibold">{ledgerMonth.getFullYear()} 年 {ledgerMonth.getMonth() + 1} 月</span><button type="button" className="grid h-7 w-7 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-muted)]" aria-label="下个月" disabled={ledgerMonth.getFullYear() === new Date().getFullYear() && ledgerMonth.getMonth() >= new Date().getMonth()} onClick={() => setLedgerMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={15} /></button></div><div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] text-[var(--muted)]">{["一","二","三","四","五","六","日"].map((day) => <span key={day}>{day}</span>)}{Array.from({ length: monthOffset }).map((_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: monthDays }, (_, index) => { const day = index + 1; const key = `${monthKey}-${String(day).padStart(2, "0")}`; return <span key={key} className={`grid aspect-square place-items-center rounded ${checkInDays.has(key) ? "bg-[color-mix(in_srgb,var(--rose)_16%,transparent)] font-semibold text-[var(--rose)]" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{day}</span>; })}</div></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-[10px] text-[var(--muted)]">本月</p><p className="mt-1 text-base font-semibold tabular-nums">{monthCheckIns}</p></div><div><p className="text-[10px] text-[var(--muted)]">累计</p><p className="mt-1 text-base font-semibold tabular-nums">{totalCheckIns}</p></div><div><p className="text-[10px] text-[var(--muted)]">累计获得</p><p className="mt-1 text-base font-semibold tabular-nums">{totalCheckInReward}</p></div></div>
            <button type="button" onClick={checkIn} disabled={!profile || !aff || !aff.checkInEnabled || aff.checkedInToday || checkingIn} className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"><CalendarCheck size={14} />{checkingIn ? "签到中…" : !aff ? "读取签到状态…" : !aff.checkInEnabled ? "签到功能未开启" : aff.checkedInToday ? "今日已签到" : `签到领取 ${aff.checkInReward} AFF`}</button>
          </section>
          <section id="profile-wallet" className="profile-card profile-wallet-card" aria-labelledby="wallet-heading"><div className="profile-card-header"><span className="profile-card-header-icon"><WalletCards size={17} /></span><div><h2 id="wallet-heading">钱包与图包</h2><p>上游余额、个人 AFF 与图包额度集中在这里管理。</p></div></div><div className="profile-wallet-grid"><div><p className="profile-wallet-label"><Coins size={13} />{capabilities?.labels.upstreamBalance || "NewAPI 余额"}</p><p className="profile-wallet-value">{walletState === "loading" ? "读取中…" : newApi ? formatDollars(newApi.balance) : "登录后读取"}</p><p className="profile-wallet-help">累计使用 {newApi ? formatDollars(newApi.used) : "登录后读取"}</p></div><div><p className="profile-wallet-label"><CalendarCheck size={13} />个人 AFF</p><p className="profile-wallet-value">{walletState === "loading" ? "读取中…" : aff ? aff.balance : "登录后读取"}</p><p className="profile-wallet-help">图包额度 {walletState === "loading" ? "读取中…" : aff ? aff.packageBalance : "登录后读取"}</p></div><div className="profile-package-buy"><p className="profile-wallet-label"><Package size={13} />购买图包</p>{walletState === "error" || !profile ? <p className="profile-wallet-help">请先登录后查看余额并购买图包。</p> : <><div className="profile-package-controls"><label className="field profile-package-count"><span>数量</span><input type="number" min={1} max={Math.max(1, maxAffordablePackages)} value={packageCount} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next)) setPackageCount(Math.min(Math.max(1, maxAffordablePackages), Math.max(1, next))); }} disabled={purchasing} /><span>包</span></label><button type="button" onClick={purchasePackages} disabled={!imagePackage?.purchaseEnabled || purchasing || maxAffordablePackages < 1 || packageCount > maxAffordablePackages} className="settings-primary-button">{purchasing ? "购买中…" : imagePackage?.purchaseEnabled ? `$${((imagePackage.priceUsd || 0) * packageCount).toFixed(0)} 购买` : "购买未启用"}</button></div><p className="profile-wallet-help">{imagePackage?.purchaseEnabled ? `每包 ${imagePackage.affPerPackage} AFF · 最多购买 ${maxAffordablePackages} 包 · ${imagePackage.rateLimit} 张/分钟` : "购买服务未配置，请联系管理员。"}</p></>}</div></div></section>
          <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5" aria-labelledby="referral-heading"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--rose)]"><Copy size={16} /></span><div><h2 id="referral-heading" className="text-base font-semibold">邀请奖励</h2><p className="mt-1 text-xs text-[var(--muted)]">好友通过链接完成注册后，奖励会自动计入你的个人 AFF。</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div><p className="text-[10px] text-[var(--muted)]">已邀请人数</p><p className="mt-1 text-xl font-semibold">{referral?.invitedCount ?? 0}</p></div><div><p className="text-[10px] text-[var(--muted)]">每次奖励</p><p className="mt-1 text-xl font-semibold">{referral?.registrationReward ?? 0} AFF</p></div></div><input ref={referralInput} aria-label="邀请注册链接" className="field mt-4 h-9 w-full px-3 text-xs" value={referralState === "loading" ? "正在生成邀请链接…" : referral && !referral.enabled ? "邀请功能未开启" : referral?.link || "邀请链接暂不可用"} readOnly disabled={!referral?.enabled} onFocus={(event) => event.currentTarget.select()} />{referralState === "error" && <p className="mt-2 text-xs text-amber-800">{referralError || "读取邀请链接失败"}</p>}<button type="button" onClick={copyReferral} disabled={!referral?.enabled || !referral.link || copyingReferral} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50"><Copy size={14} />{copyingReferral ? "复制中…" : referral && !referral.enabled ? "邀请功能未开启" : "复制邀请链接"}</button></section>
          <section className="profile-card" aria-labelledby="ledger-heading"><div className="profile-card-header"><span className="profile-card-header-icon"><Copy size={16} /></span><div><h2 id="ledger-heading">奖励流水</h2><p>个人 AFF / 图包额度分开计账。</p></div></div><div className="mt-4 space-y-2">{ledger?.transactions.slice(0, 6).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-2 text-xs last:border-0"><div><p className="font-semibold">{item.description}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.source === "package" ? "图包额度" : "个人 AFF"}</p></div><b className={item.amount >= 0 ? "text-[var(--mint)]" : "text-[var(--rose)]"}>{item.amount >= 0 ? "+" : ""}{item.amount}</b></div>)}{!ledger?.transactions.length && <p className="py-5 text-center text-xs text-[var(--muted)]">暂无奖励流水</p>}</div></section>
        </div>
        <div id="profile-info" className="profile-section">
        <form onSubmit={save} className="profile-field-grid">
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
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_.\\-]{3,32}"
              autoComplete="username"
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
              required
              maxLength={40}
              autoComplete="nickname"
              disabled={!profile}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold">邮箱</label>
            <div className="field flex items-center px-3 text-sm text-[var(--muted)]">
              {profile?.email || "未公开"}
            </div>
          </div>
          {message && <p className="profile-status-notice">{message}</p>}
          <button
            type="submit"
            disabled={!profile || saving}
            className="flex h-11 items-center gap-2 rounded bg-[var(--rose)] px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "保存中…" : "保存资料"}
          </button>
        </form>
        </div>
        <div id="profile-security" className="profile-section">
        <form onSubmit={changePassword} className="profile-card profile-field-grid">
          <div className="profile-card-header">
            <span className="profile-card-header-icon"><LockKeyhole size={17} /></span>
            <div><h2>密码与安全</h2><p>修改密码后，所有设备上的登录状态都会退出。</p></div>
          </div>
          <label className="block text-xs font-semibold">当前密码<input className="field mt-2 w-full px-3" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={!profile || passwordSaving} /></label>
          <label className="block text-xs font-semibold">新密码<input className="field mt-2 w-full px-3" type="password" autoComplete="new-password" minLength={8} maxLength={64} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={!profile || passwordSaving} /></label>
          <label className="block text-xs font-semibold">确认新密码<input className="field mt-2 w-full px-3" type="password" autoComplete="new-password" minLength={8} maxLength={64} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={!profile || passwordSaving} /></label>
          <button type="submit" disabled={!profile || passwordSaving || !currentPassword || !newPassword || !confirmPassword} className="flex h-11 items-center gap-2 rounded bg-[var(--rose)] px-5 text-sm font-semibold text-white disabled:opacity-50"><LockKeyhole size={16} />{passwordSaving ? "更新中…" : "更新密码"}</button>
        </form>
        </div>
        </div>
      </section>
    </main>
  );
}
