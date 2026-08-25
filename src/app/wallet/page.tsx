"use client";

import { ArrowLeft, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Wallet = {
  newApi: { balance: number; used: number; group: string };
  aff: { enabled: boolean; balance: number };
  rechargeEnabled: boolean;
};

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/wallet", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取钱包失败");
        setWallet(result);
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "读取钱包失败"),
      );
  }, []);
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <PageHeader title="余额钱包" />
      <section className="mx-auto max-w-5xl p-4 sm:p-8">
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
            <strong>
              {wallet?.aff.enabled ? wallet.aff.balance.toFixed(2) : "未启用"}
            </strong>
            <p>独立奖励账本尚未启用时，不会影响或代扣 NewAPI 钱包。</p>
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
