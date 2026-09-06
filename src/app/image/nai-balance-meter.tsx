"use client";

import Link from "next/link";
import { balancePreview } from "./balance-preview";

export function NaiBalanceMeter({ balance, cost, unit, signedIn }: {
  balance: number | null | undefined;
  cost: number | null;
  unit: "AFF" | "USD";
  signedIn: boolean;
}) {
  if (!signedIn) {
    return <div className="nai-balance-meter"><span>体验模式 · 不扣费</span><Link href="/sign-in">登录</Link></div>;
  }
  const preview = cost == null ? null : balancePreview(balance, cost);
  if (!preview) {
    return <div className="nai-balance-meter"><span>余额或价格暂不可用</span><Link href="/account">钱包</Link></div>;
  }
  const format = (value: number) => unit === "AFF" ? `${value.toLocaleString("zh-CN")} AFF` : `$${value.toFixed(2)}`;
  return (
    <div className="nai-balance-meter">
      <span>{preview.insufficient ? "余额不足" : "可用余额"} · {format(preview.available)}</span>
      <Link href="/account">钱包</Link>
      <div
        role="progressbar"
        aria-label="本次生成后预计剩余余额"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(preview.percent)}
        aria-valuetext={`预计消耗 ${format(preview.required)}，剩余 ${format(preview.remaining)}`}
        title={`预计消耗 ${format(preview.required)}，剩余 ${format(preview.remaining)}`}
        className="nai-balance-track"
      ><span style={{ width: `${preview.percent}%` }} /></div>
    </div>
  );
}
