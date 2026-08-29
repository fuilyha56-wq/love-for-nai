"use client";

import { ArrowLeft, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type Wallet = {
  newApi: { balance: number; used: number; group: string };
  aff: { enabled: boolean; balance: number; checkedInToday: boolean; checkInReward: number };
  rechargeEnabled: boolean;
};

const formatDollars = (value: number): string =>
  `$${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
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
    setCheckingIn(true);
    try {
      const response = await fetch("/api/aff/check-in", { method: "POST" });
      const result = await readJson<{ balance: number; reward: number }>(response, "签到失败");
      setWallet((current) =>
        current
          ? { ...current, aff: { ...current.aff, balance: result.balance, checkedInToday: true } }
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
        <div className="grid gap-4 md:grid-cols-2">
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
            <span>LFN AFF</span>
            <strong>
              {loadState === "loading"
                ? "读取中…"
                : wallet?.aff.enabled
                  ? wallet.aff.balance
                  : "暂无 AFF 数据"}
            </strong>
            <p>每日签到获得 20 AFF。V4.5 limit 每张 1 AFF，V5 limit 每张 1.5 AFF，按订单向上取整。</p>
            <button
              type="button"
              onClick={checkIn}
              disabled={!wallet?.aff.enabled || wallet.aff.checkedInToday || checkingIn}
              className="mt-4 h-9 rounded bg-[#292d2c] px-4 text-xs font-semibold text-white disabled:opacity-50"
            >
              {checkingIn ? "签到中…" : wallet?.aff.checkedInToday ? "今日已签到" : "每日签到 +20 AFF"}
            </button>
          </article>
        </div>
        <p className="mt-5 text-xs leading-6 text-[var(--muted)]">
          余额直接读取 NewAPI 实时数值。LFN 不复制余额，也不提供充值入口。
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
