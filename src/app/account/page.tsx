"use client";

import {
  ArrowLeft,
  CalendarCheck,
  Coins,
  Copy,
  Images,
  Package,
  Save,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  checkInReward: number;
};
type NewApiWallet = { balance: number; used: number; group: string };
type ImagePackage = {
  balance: number;
  totalBalance: number;
  priceUsd: number;
  affPerPackage: number;
  rateLimit: number;
  purchaseEnabled: boolean;
};
type Referral = {
  link: string;
  invitedCount: number;
  registrationReward: number;
};
const formatDollars = (value: number): string =>
  `$${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;

// crypto.randomUUID 要求安全上下文（HTTPS），HTTP 部署下不可用，
// 用 getRandomValues 兜底生成同格式的 UUID v4。
function browserUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [saving, setSaving] = useState(false);
  const [aff, setAff] = useState<Aff | null>(null);
  const [newApi, setNewApi] = useState<NewApiWallet | null>(null);
  const [imagePackage, setImagePackage] = useState<ImagePackage | null>(null);
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
  const referralInput = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    setProfileState("loading");
    setProfileError("");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.authenticated) {
        setExpired("登录状态已过期，请重新登录后查看账号信息");
        setProfileError("登录状态已过期，请重新登录后查看账号信息");
        setProfileState("error");
        return;
      }
      setProfile(result.user);
      setUsername(result.user.username || "");
      setDisplayName(result.user.displayName || "");
      setProfileState("loaded");
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "读取账号信息失败";
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
      const result = await readJson<{
        aff?: Aff;
        newApi?: NewApiWallet;
        imagePackage?: ImagePackage;
      }>(response, "读取钱包失败");
      setAff(result.aff || null);
      setNewApi(result.newApi || null);
      setImagePackage(result.imagePackage || null);
      setWalletState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取钱包失败";
      setWalletError(nextError);
      setMessage(nextError);
      setWalletState("error");
    }
  }, []);
  const loadReferral = useCallback(async () => {
    setReferralState("loading");
    setReferralError("");
    try {
      const response = await fetch("/api/aff/referral", { cache: "no-store" });
      const result = await readJson<Referral>(response, "读取邀请链接失败");
      if (!result.link) throw new Error("邀请链接暂不可用");
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
    });
  }, [loadProfile, loadReferral, loadWallet]);

  async function checkIn() {
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

  async function purchasePackages() {
    if (!imagePackage?.purchaseEnabled || purchasing) return;
    const price = imagePackage.priceUsd * packageCount;
    const affAmount = imagePackage.affPerPackage * packageCount;
    if (
      !window.confirm(
        `确认使用 $${price.toFixed(2)} NewAPI 余额购买 ${packageCount} 包图包，获得 ${affAmount} 图包 AFF？`,
      )
    )
      return;
    setPurchasing(true);
    setMessage("");
    try {
      const response = await fetch("/api/image-packages/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: browserUuid(), packageCount }),
      });
      const result = await readJson<{ packageBalance?: number }>(response, "图包购买失败");
      await loadWallet();
      setMessage(
        result.packageBalance != null
          ? `购买成功，图包额度现为 ${result.packageBalance} AFF。`
          : `购买成功，获得 ${affAmount} 图包 AFF。`,
      );
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "图包购买失败");
    } finally {
      setPurchasing(false);
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
        {profileState === "error" && !expired && (
          <div className="rounded-md border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            <p>{profileError || "读取账号信息失败"}</p>
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="mt-2 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
            >
              重试
            </button>
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
                  {profileState === "loading"
                    ? "读取中…"
                    : profile?.displayName || "个人资料暂不可用"}
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

          {/* 钱包：余额 / AFF / 图包 一张紧凑卡 */}
          <article className="panel min-w-0 rounded-md p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
                WALLET · 余额与图包
              </p>
              {walletState === "error" && (
                <button
                  type="button"
                  onClick={() => void loadWallet()}
                  className="h-7 rounded border border-[var(--line)] bg-white px-2.5 text-[11px] font-semibold"
                >
                  重试
                </button>
              )}
            </div>
            {walletState === "error" && !newApi && (
              <p className="mt-3 text-xs text-[#77531e]">{walletError || "读取钱包失败"}</p>
            )}
            <dl className="mt-4 divide-y divide-[var(--line)] text-sm">
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <Coins size={14} className="text-[var(--rose)]" /> NewAPI 余额
                </dt>
                <dd className="min-w-0 break-all text-right font-semibold tabular-nums">
                  {walletState === "loading"
                    ? "读取中…"
                    : newApi
                      ? formatDollars(newApi.balance)
                      : "暂无数据"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="shrink-0 text-xs font-semibold text-[var(--muted)]">累计使用</dt>
                <dd className="min-w-0 break-all text-right text-xs tabular-nums text-[var(--muted)]">
                  {walletState === "loading"
                    ? "读取中…"
                    : newApi
                      ? formatDollars(newApi.used)
                      : "暂无数据"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <CalendarCheck size={14} className="text-[var(--rose)]" /> 个人 AFF
                </dt>
                <dd className="text-right font-semibold tabular-nums">
                  {walletState === "loading" ? "读取中…" : (aff?.balance ?? 0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <Package size={14} className="text-[var(--rose)]" /> 图包额度
                </dt>
                <dd className="text-right font-semibold tabular-nums">
                  {walletState === "loading" ? "读取中…" : (aff?.packageBalance ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
              生成优先消耗图包额度（最多 {imagePackage?.rateLimit ?? 10} 张/分钟），再消耗个人 AFF，两者都不足才使用 NewAPI 余额。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={checkIn}
                disabled={!profile || !aff || aff.checkedInToday || checkingIn}
                className="h-9 flex-1 rounded bg-[#292d2c] px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {checkingIn
                  ? "签到中…"
                  : aff?.checkedInToday
                    ? "今日已签到"
                    : `签到 +${aff?.checkInReward ?? 20} AFF`}
              </button>
              {imagePackage && (
                <div className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded border border-[var(--line)] bg-white px-2">
                  <label htmlFor="package-count" className="shrink-0 text-xs font-semibold text-[var(--muted)]">购买</label>
                  <input
                    id="package-count"
                    type="number"
                    min={1}
                    max={10}
                    value={packageCount}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next)) setPackageCount(Math.min(10, Math.max(1, next)));
                    }}
                    className="h-7 w-12 rounded border border-[var(--line)] px-1 text-center text-sm tabular-nums"
                    disabled={purchasing}
                  />
                  <span className="shrink-0 text-xs text-[var(--muted)]">包</span>
                </div>
              )}
              {imagePackage && (
                <button
                  type="button"
                  onClick={purchasePackages}
                  disabled={!imagePackage.purchaseEnabled || purchasing}
                  className="h-9 flex-1 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                  title={`每包 $${imagePackage.priceUsd}，获得 ${imagePackage.affPerPackage} AFF`}
                >
                  {purchasing
                    ? "购买中…"
                    : imagePackage.purchaseEnabled
                      ? `$${(imagePackage.priceUsd * packageCount).toFixed(0)} 买 ${packageCount} 包`
                      : "图包购买未启用"}
                </button>
              )}
            </div>
          </article>
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
              value={
                referralState === "loading"
                  ? "正在生成邀请链接…"
                  : referral?.link || "邀请链接暂不可用"
              }
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            {referralState === "error" && (
              <div className="mt-2 rounded border border-[#e4c991] bg-[#fff8e8] p-2 text-xs text-[#77531e]">
                <p>{referralError || "读取邀请链接失败"}</p>
                <button
                  type="button"
                  onClick={() => void loadReferral()}
                  className="mt-2 h-7 rounded bg-[var(--rose)] px-2.5 text-[11px] font-semibold text-white"
                >
                  重试
                </button>
              </div>
            )}
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
