"use client";

import { ArrowLeft, Package, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type Wallet = {
  newApi: { balance: number; used: number; group: string };
  aff: {
    enabled: boolean;
    balance: number;
    packageBalance: number;
    totalBalance: number;
    packageRateLimitRemaining: number;
    checkedInToday: boolean;
    checkInReward: number;
  };
  imagePackage: {
    balance: number;
    totalBalance: number;
    priceUsd: number;
    affPerPackage: number;
    rateLimit: number;
    purchaseEnabled: boolean;
  };
  rechargeEnabled: boolean;
};

const formatDollars = (value: number): string =>
  `$${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [packageCount, setPackageCount] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      const result = await readJson<Wallet>(response, "读取钱包失败");
      setWallet(result);
      setLoadState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取钱包失败";
      setLoadError(nextError);
      setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function checkIn() {
    if (!wallet?.aff || checkingIn) return;
    setCheckingIn(true);
    setMessage("");
    try {
      const response = await fetch("/api/aff/check-in", { method: "POST" });
      const result = await readJson<{
        balance: number;
        packageBalance: number;
        totalBalance: number;
        reward: number;
        checkedInToday: boolean;
      }>(response, "签到失败");
      setWallet((current) =>
        current
          ? {
              ...current,
              aff: {
                ...current.aff,
                balance: result.balance,
                packageBalance: result.packageBalance,
                totalBalance: result.totalBalance,
                checkedInToday: result.checkedInToday,
              },
                imagePackage: {
                  ...current.imagePackage,
                  balance: result.packageBalance,
                  totalBalance: result.totalBalance,
                },
            }
          : current,
      );
      setMessage(result.reward ? `签到成功，获得 ${result.reward} AFF。` : "今日已签到。");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "签到失败");
    } finally {
      setCheckingIn(false);
    }
  }

  async function purchasePackages() {
    if (!wallet?.imagePackage.purchaseEnabled || purchasing) return;
    const price = wallet.imagePackage.priceUsd * packageCount;
    const affAmount = wallet.imagePackage.affPerPackage * packageCount;
    if (!window.confirm(`确认使用 $${price.toFixed(2)} NewAPI 余额购买 ${packageCount} 包图包，获得 ${affAmount} 图包 AFF？`))
      return;
    setPurchasing(true);
    setMessage("");
    try {
      const response = await fetch("/api/image-packages/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), packageCount }),
      });
      const result = await readJson<{ packageBalance?: number }>(response, "图包购买失败");
      await load();
      setMessage(
        result.packageBalance != null
          ? `购买成功，图包额度现为 ${result.packageBalance} AFF。`
          : `购买成功，获得 ${packageCount * wallet.imagePackage.affPerPackage} 图包 AFF。`,
      );
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "图包购买失败");
    } finally {
      setPurchasing(false);
    }
  }
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <PageHeader title="余额钱包" />
      <section className="mx-auto max-w-5xl p-4 sm:p-8">
        {expired && <SessionExpiredNotice message={expired} />}
        {message && <Message text={message} />}
        {loadState === "error" && (
          <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-4 text-sm text-[#77531e]">
            <p>{loadError || "读取钱包失败"}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
            >
              重试
            </button>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <article className="wallet-panel">
            <span>NewAPI 钱包</span>
            <strong>
              {loadState === "loading"
                ? "读取中…"
                : wallet
                  ? formatDollars(wallet.newApi.balance)
                  : "暂无余额数据"}
            </strong>
            <dl>
              <div>
                <dt>累计使用</dt>
                <dd>{wallet ? formatDollars(wallet.newApi.used) : loadState === "loading" ? "读取中…" : "暂无数据"}</dd>
              </div>
              <div>
                <dt>当前分组</dt>
                <dd>{wallet?.newApi.group || (loadState === "loading" ? "读取中…" : "暂无数据")}</dd>
              </div>
            </dl>
          </article>
          <article className="wallet-panel">
            <span>个人 AFF + 图包额度</span>
            <strong>
              {loadState === "loading"
                ? "读取中…"
                : wallet?.aff
                  ? `${wallet.aff.balance} + ${wallet.aff.packageBalance}`
                  : "暂无 AFF 数据"}
            </strong>
            <p>
              个人 AFF：签到、邀请所得；图包额度：购买所得。生成时优先消耗图包额度，再消耗个人 AFF。
            </p>
            <button
              type="button"
              onClick={checkIn}
              disabled={!wallet?.aff || wallet.aff.checkedInToday || checkingIn}
              className="mt-4 h-9 rounded bg-[#292d2c] px-4 text-xs font-semibold text-white disabled:opacity-50"
            >
              {checkingIn ? "签到中…" : wallet?.aff.checkedInToday ? "今日已签到" : "每日签到 +20 AFF"}
            </button>
          </article>
          <article className="wallet-panel">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-[var(--rose)]" />
              <span>图包额度</span>
            </div>
            <strong>
              {loadState === "loading"
                ? "读取中…"
                : wallet?.imagePackage
                  ? `${wallet.imagePackage.balance} AFF`
                  : "暂无数据"}
            </strong>
            <p>
              每包 {wallet?.imagePackage.priceUsd ?? 200} 美元，获得 {wallet?.imagePackage.affPerPackage ?? 400} AFF 图包额度；图包生成最多 {wallet?.imagePackage.rateLimit ?? 10} 张/分钟。
            </p>
            <div className="mt-4 flex items-center gap-2">
              <label htmlFor="package-count" className="text-xs text-[var(--muted)]">购买</label>
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
                className="field h-9 w-16 px-2 text-center text-sm"
                disabled={purchasing}
              />
              <span className="text-xs text-[var(--muted)]">包</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-[var(--rose)]">
              合计 ${((wallet?.imagePackage.priceUsd ?? 200) * packageCount).toFixed(2)} · +{(wallet?.imagePackage.affPerPackage ?? 400) * packageCount} AFF
            </p>
            <button
              type="button"
              onClick={purchasePackages}
              disabled={!wallet?.imagePackage.purchaseEnabled || purchasing}
              className="mt-3 h-9 w-full rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {purchasing ? "购买中…" : wallet?.imagePackage.purchaseEnabled ? "使用 NewAPI 余额购买" : "图包购买暂未启用"}
            </button>
          </article>
        </div>
        <p className="mt-5 text-xs leading-6 text-[var(--muted)]">
          图包购买会从你的 NewAPI 美元余额扣除，额度仅用于 LFN 网页工作台和内部图片接口生成；个人 AFF 与图包额度不可提现或互相兑换。
        </p>
      </section>
    </main>
  );
}
function PageHeader({ title }: { title: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
      <div className="flex items-center gap-3">
        <WalletCards size={20} className="text-[var(--rose)]" />
        <b>{title}</b>
      </div>
      <Link
        href="/image"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <ArrowLeft size={16} />
        返回工作台
      </Link>
    </header>
  );
}
function Message({ text }: { text: string }) {
  return (
    <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
      {text}
    </div>
  );
}
