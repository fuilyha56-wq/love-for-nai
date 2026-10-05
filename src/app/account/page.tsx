"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import {
  ArrowLeft,
  CalendarCheck,
  Coins,
  Images,
  Package,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import "./account.css";
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
type WalletCapabilities = {
  wallet: {
    upstreamBalance: boolean;
    credits: boolean;
    packages: boolean;
  };
  labels: {
    upstreamBalance: string;
    credits: string;
    packages: string;
  };
  image?: { label: string };
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
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [aff, setAff] = useState<Aff | null>(null);
  const [newApi, setNewApi] = useState<NewApiWallet | null>(null);
  const [imagePackage, setImagePackage] = useState<ImagePackage | null>(null);
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
  const [packageCount, setPackageCount] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [profileState, setProfileState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [profileError, setProfileError] = useState("");
  const [walletState, setWalletState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [walletError, setWalletError] = useState("");

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
        capabilities?: WalletCapabilities;
      }>(response, "读取钱包失败");
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
  useEffect(() => {
    void Promise.resolve().then(() => {
      loadProfile();
      loadWallet();
    });
  }, [loadProfile, loadWallet]);

  const maxAffordablePackages = imagePackage && newApi
    ? Math.min(10, Math.max(0, Math.floor(newApi.balance / imagePackage.priceUsd)))
    : 0;

  async function purchasePackages() {
    if (!imagePackage?.purchaseEnabled || purchasing) return;
    if (maxAffordablePackages < 1 || packageCount > maxAffordablePackages) {
      setMessage(
        maxAffordablePackages < 1
          ? "NewAPI 余额不足，无法购买图包。"
          : `当前余额最多购买 ${maxAffordablePackages} 包图包。`,
      );
      return;
    }
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

  return (
    <main className="workspace-page account-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="account-page-header sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--line)] px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3">
          <UserRound size={20} className="text-[var(--rose)]" />
          <b>我的账号</b>
          <span className="hidden text-xs text-[var(--muted)] sm:inline">
            钱包 · 额度 · 图包购买
          </span>
        </div>
        <Link href="/image" className="flex items-center gap-2 text-sm font-semibold">
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>
      <WorkspaceNav />
      {expired && (
        <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-8">
          <SessionExpiredNotice message={expired} />
        </div>
      )}
      <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div><b className="text-sm">钱包与创作额度</b><p className="mt-1 text-xs text-[var(--muted)]">查看上游余额、个人 AFF 和图包额度；模型来源仍可在设置中统一管理。</p></div>
          <Link href="/resources#story-providers" className="inline-flex items-center gap-2 rounded border border-[var(--rose)] px-3 py-2 text-xs font-semibold text-[var(--rose)]"><WalletCards size={15} />管理自定义 API</Link>
        </div>
        {message && (
          <div className="account-status-notice">
            {message}
          </div>
        )}
        {profileState === "error" && !expired && (
          <div className="account-status-notice">
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
        <div className="account-summary-grid">
          <article className="account-identity-card panel rounded-md p-5">
            <div className="flex items-center gap-4">
              <div className="account-avatar">
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
          <article className="account-wallet-card panel min-w-0 rounded-md p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
                WALLET · 余额与图包
              </p>
              {walletState === "error" && (
                <button
                  type="button"
                  onClick={() => void loadWallet()}
                  className="settings-secondary-button h-8 px-2.5 text-[11px]"
                >
                  重试
                </button>
              )}
            </div>
            {walletState === "error" && !newApi && !aff && (
              <p className="account-muted-error">{walletError || "读取钱包失败"}</p>
            )}
            <dl className="mt-4 divide-y divide-[var(--line)] text-sm">
              {capabilities?.wallet.upstreamBalance !== false && (
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <Coins size={14} className="text-[var(--rose)]" /> {capabilities?.labels.upstreamBalance || "上游余额"}
                </dt>
                <dd className="min-w-0 break-all text-right font-semibold tabular-nums">
                  {walletState === "loading"
                    ? "读取中…"
                    : newApi
                      ? formatDollars(newApi.balance)
                      : "暂无数据"}
                </dd>
              </div>
              )}
              {capabilities?.wallet.upstreamBalance !== false && (
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
              )}
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <CalendarCheck size={14} className="text-[var(--rose)]" /> 个人 {capabilities?.labels.credits || "AFF"}
                </dt>
                <dd className="text-right font-semibold tabular-nums">
                  {walletState === "loading" ? "读取中…" : (aff?.balance ?? 0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                  <Package size={14} className="text-[var(--rose)]" /> {capabilities?.labels.packages || "图包额度"}
                </dt>
                <dd className="text-right font-semibold tabular-nums">
                  {walletState === "loading" ? "读取中…" : (aff?.packageBalance ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
              生成优先消耗图包额度（最多 {imagePackage?.rateLimit ?? 10} 张/分钟），再消耗个人创作额度。
              {capabilities?.wallet.upstreamBalance
                ? "两者都不足才使用上游余额。"
                : capabilities?.image?.label
                  ? `当前图像上游：${capabilities.image.label}。`
                  : ""}
            </p>
            <div className="account-wallet-actions">
              <div className="account-checkin-summary">
                <CalendarCheck size={15} className="text-[var(--rose)]" />
                <span>{aff?.checkedInToday ? "今日已签到" : "签到与奖励在个人资料页管理"}</span>
              </div>
              <Link href="/profile#profile-rewards" className="settings-secondary-button">查看签到与奖励</Link>
              {imagePackage && (
                <div className="account-package-purchase">
                  <div className="account-package-count field">
                    <label htmlFor="package-count">购买</label>
                    <input
                      id="package-count"
                      type="number"
                      min={1}
                      max={Math.max(1, maxAffordablePackages)}
                      value={packageCount}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isInteger(next)) setPackageCount(Math.min(Math.max(1, maxAffordablePackages), Math.max(1, next)));
                      }}
                      disabled={purchasing}
                    />
                    <span>包</span>
                  </div>
                  <p>当前余额最多可买 {maxAffordablePackages} 包</p>
                </div>
              )}
              {imagePackage && (
                <button
                  type="button"
                  onClick={purchasePackages}
                  disabled={!imagePackage.purchaseEnabled || purchasing || maxAffordablePackages < 1 || packageCount > maxAffordablePackages}
                  className="settings-primary-button"
                  title={`每包 $${imagePackage.priceUsd}，获得 ${imagePackage.affPerPackage} AFF`}
                >
                  {purchasing ? "购买中…" : imagePackage.purchaseEnabled ? `$${(imagePackage.priceUsd * packageCount).toFixed(0)} 买 ${packageCount} 包` : "图包购买未启用"}
                </button>
              )}
            </div>
          </article>
        </div>

        <section className="account-next-steps panel" aria-labelledby="account-next-steps-heading">
          <div>
            <p className="account-kicker">PROFILE · 奖励与安全</p>
            <h2 id="account-next-steps-heading">资料、签到、邀请和密码安全</h2>
            <p>这些内容集中在个人资料中心，避免在账号仪表盘重复维护。</p>
          </div>
          <div className="account-next-actions">
            <Link href="/profile#profile-info" className="settings-primary-button">编辑个人资料</Link>
            <Link href="/profile#profile-rewards" className="settings-secondary-button">查看奖励与邀请</Link>
            <Link href="/profile#profile-security" className="settings-secondary-button">密码与安全</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
