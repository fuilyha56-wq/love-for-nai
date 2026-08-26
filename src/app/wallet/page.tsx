"use client";

import { ArrowLeft, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  useEffect(() => {
    fetch("/api/wallet", { cache: "no-store" })
      .then((response) => readJson<Wallet>(response, "读取钱包失败"))
      .then(setWallet)
      .catch((error) => {
        if (error instanceof SessionExpiredError) setExpired(error.message);
        else setMessage(error instanceof Error ? error.message : "读取钱包失败");
      });
  }, []);
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
        <div className="grid gap-4 md:grid-cols-2">
          <article className="wallet-panel">
            <span>NewAPI 钱包</span>
            <strong>{wallet ? wallet.newApi.balance.toFixed(2) : "--"}</strong>
            <dl>
              <div>
                <dt>累计使用</dt>
                <dd>{wallet ? wallet.newApi.used.toFixed(2) : "--"}</dd>
              </div>
              <div>
                <dt>当前分组</dt>
                <dd>{wallet?.newApi.group || "--"}</dd>
              </div>
            </dl>
          </article>
          <article className="wallet-panel">
            <span>LFN AFF</span>
            <strong>{wallet?.aff.enabled ? wallet.aff.balance : "--"}</strong>
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
