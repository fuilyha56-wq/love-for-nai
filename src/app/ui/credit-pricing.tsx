"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calculator, RefreshCw, X } from "lucide-react";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import { usePanelHistory } from "./use-panel-history";
import { dailyImageDay, roundAffAmount, type DailyImageBillingState } from "@/lib/daily-image-pricing";
import { CNY_PER_AFF, splitImageCreditCost, type ImagePricingGeneration } from "@/lib/image-pricing";
import { formatAff, formatCny, quoteCredits, type CreditPricing } from "@/lib/credit-pricing";
import "./credit-pricing.css";

export function useCreditPricing() {
  const [data, setData] = useState<CreditPricing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/public/credit-pricing", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.policy || !result.fixedCosts || result.cnyPerAff !== CNY_PER_AFF)
        throw new Error(result.message || "暂时无法读取本站计价");
      setData(result); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "价格读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data, error, loading, refresh };
}

export function CreditPriceTables({ pricing, state }: { pricing: CreditPricing; state?: DailyImageBillingState }) {
  const { policy } = pricing;
  return <div className="credit-price-tables">
    <p className="credit-price-note">1 AFF = ¥0.005。图包与个人 AFF 使用同一价格；金额保留最多 4 位小数，不按整数取整。每日张数按北京时间零点重置，limit 与普通模型合并计数。</p>
    <div className="credit-price-table-scroll" tabIndex={0} role="region" aria-label="基础价格表，可横向滚动">
      <table><caption>基础价格</caption><thead><tr><th>模型 / 操作</th><th>基础费</th><th>额外 Anlas 单价</th></tr></thead><tbody>
        <tr><th>V4.5 生图</th><td>1 AFF / 张</td><td>¥{formatCny(policy.v45AnlasCny)} = {formatAff(policy.v45AnlasCny / CNY_PER_AFF)} AFF</td></tr>
        <tr><th>V5 常规 · High 生图</th><td>5 AFF / 张</td><td>¥{formatCny(policy.v5AnlasCny)} = {formatAff(policy.v5AnlasCny / CNY_PER_AFF)} AFF</td></tr>
        <tr><th>V5 低成本 · Medium 生图</th><td>1 AFF / 张</td><td>同 V5 单价，Anlas 量按 Medium 计算</td></tr>
        <tr><th>超分 / 导演 / Vibe 编码</th><td>无生图基础费</td><td>模型对应的单价 × 本次 Anlas</td></tr>
        <tr><th>图片标注</th><td>1 AFF / 张</td><td>无</td></tr>
        {Object.entries(pricing.fixedCosts).map(([model, cost]) => <tr key={model}><th>{model} · 固定价优先</th><td>{formatAff(cost)} AFF / 张</td><td>覆盖该模型的公式与每日阶梯</td></tr>)}
      </tbody></table>
    </div>
    <p className="credit-price-note">单张、≤28 步、≤1024² 像素且无付费参考等条件全部满足时，仅收基础费。多张一次提交、超出范围或付费参考会额外计 Anlas；逐张提交按各张参数分别计算。</p>
    {!policy.enabled && <p className="credit-price-warning">每日阶梯当前关闭：生图按基础费加 Anlas 费用计算。</p>}
    {(["v45", "v5"] as const).map(family => {
      const count = state?.day === dailyImageDay() ? state.counts[family] : 0;
      const tiers = policy[family];
      const rate = family === "v5" ? policy.v5AnlasCny : policy.v45AnlasCny;
      return <div key={family} className="credit-price-table-scroll" tabIndex={0} role="region" aria-label={`${family === "v5" ? "V5" : "V4.5"} 每日阶梯表，可横向滚动`}>
        <table><caption>{family === "v5" ? "V5" : "V4.5"} 每日阶梯{state ? ` · 今日 ${count} 张` : " · 从第 1 张计数"}</caption>
          <thead><tr><th>当天第几张</th><th>每日附加费</th><th>Anlas 倍率</th><th>整体倍率</th><th>常规档内 / 张</th><th>有效 Anlas 价</th></tr></thead>
          <tbody>{tiers.map((tier, index) => {
            const base = family === "v5" ? 5 : 1;
            const extra = Math.max(0, tier.baseCny - tiers[0].baseCny);
            const active = !!state && policy.enabled && count >= tier.afterImages && (tiers[index + 1] == null || count < tiers[index + 1].afterImages);
            return <tr key={tier.afterImages} data-current-tier={active || undefined}>
              <th>{tier.afterImages + 1}–{tiers[index + 1]?.afterImages ?? "以后"}{active && <small>下一张</small>}</th>
              <td>¥{formatCny(extra)} / {formatAff(extra / CNY_PER_AFF)} AFF</td><td>×{tier.anlasMultiplier}</td><td>×{tier.totalMultiplier}</td>
              <td>{formatAff((base + extra / CNY_PER_AFF) * tier.totalMultiplier)} AFF</td>
              <td>¥{formatCny(rate * tier.anlasMultiplier * tier.totalMultiplier)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>;
    })}
    <p className="credit-price-note">每张 AFF =（基础 AFF + 每日附加费 ÷ 0.005 + 计费 Anlas × 单价 × Anlas 倍率 ÷ 0.005）× 整体倍率。附加费为本档参考值减首档参考值，最低为 0；跨档批次按每张所属阶梯结算。独立操作不参与每日阶梯。</p>
  </div>;
}

type Wallet = { balance: number; packageBalance: number; packageRateLimitRemaining: number };
export function CreditPricingButton({ children, className = "", pricing, generation, state, wallet, usesAff, paymentNote, onRefresh }: {
  children?: ReactNode; className?: string; pricing: ReturnType<typeof useCreditPricing>;
  generation: ImagePricingGeneration; state?: DailyImageBillingState; wallet?: Wallet;
  usesAff: boolean; paymentNote: string; onRefresh?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, ref);
  usePanelHistory(`lfnCreditPricing-${id}`, open ? "open" : null, value => setOpen(value === "open"));
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const quote = pricing.data ? quoteCredits(generation, pricing.data, state) : null;
  const split = quote && usesAff && wallet ? splitImageCreditCost(quote.costAff, generation.samples, wallet.packageBalance, wallet.packageRateLimitRemaining, quote.daily?.affCosts) : null;
  return <>
    <button type="button" className={`credit-pricing-trigger ${className}`} data-credit-pricing-trigger aria-label="查看当前定价与阶梯计费" aria-haspopup="dialog" onClick={() => { setOpen(true); void pricing.refresh(); void onRefresh?.(); }}>
      {children || <><Calculator size={14} /><span>定价与阶梯计费</span></>}
    </button>
    {open && createPortal(<div className="credit-pricing-backdrop" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="credit-pricing-dialog" ref={ref} role="dialog" aria-modal="true" aria-label="当前定价与阶梯计费" tabIndex={-1} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
        <header><div><span>LFN · 费用明细</span><h2>当前定价与阶梯计费</h2></div><button type="button" aria-label="关闭计费明细" onClick={() => setOpen(false)}><X size={21} /></button></header>
        <div className="credit-pricing-body">
          <p className="credit-price-payment">{paymentNote}</p>
          {pricing.error && <p className="credit-price-warning">{pricing.error}。{pricing.data ? "下面保留上次读取的规则，可能已变更。" : "暂不展示未经确认的价格。"}</p>}
          {quote && <section className="credit-price-quote" aria-label="本次生成费用明细">
            <h3>{usesAff ? "本次预估" : "本次参数的 AFF 参考价"} <b>{formatAff(quote.costAff)} AFF <small>≈ ¥{formatCny(quote.costCny)}</small></b></h3>
            <p>{generation.model} · {generation.width} × {generation.height} · {generation.steps} 步 · {generation.samples} 张{generation.sequential ? " · 逐张提交" : " · 一次提交"}</p>
            <p>{quote.fixed != null ? `固定价 ${formatAff(quote.fixed)} AFF / 张，覆盖每日阶梯。` : quote.daily ? `今日从第 ${quote.daily.startCount + 1} 张起计，本次计费 Anlas 共 ${formatAff(quote.daily.anlas)}。${quote.daily.anlas === 0 ? "本次没有额外 Anlas 费用，价格由基础费与每日阶梯决定。" : "已按当前单价和各张阶梯计算。"}` : "本次不参与每日阶梯，按当前单价计算。"}</p>
            {usesAff && wallet && <p>图包余额 {formatAff(wallet.packageBalance)} AFF · 个人余额 {formatAff(wallet.balance)} AFF。图包优先，个人补足；图包当前窗口可用 {wallet.packageRateLimitRemaining} 张。</p>}
            {split && <p>预计扣图包 <b>{formatAff(split.packageCost)} AFF</b> + 个人 <b>{formatAff(split.personalCost)} AFF</b>{wallet && split.personalCost > wallet.balance ? "，当前个人 AFF 不足。" : "。"}</p>}
            {quote.daily && <div className="credit-price-table-scroll" tabIndex={0} role="region" aria-label="逐张预估费用">
              <table><thead><tr><th>当天第几张</th><th>预估 AFF</th><th>人民币面值</th></tr></thead><tbody>{quote.daily.affCosts.map((cost, index) => <tr key={index}><th>{quote.daily!.startCount + index + 1}</th><td>{formatAff(cost)}</td><td>¥{formatCny(roundAffAmount(cost) * CNY_PER_AFF)}</td></tr>)}</tbody></table>
            </div>}
          </section>}
          {pricing.data ? <CreditPriceTables pricing={pricing.data} state={state} /> : pricing.loading && <p>正在读取服务器价格…</p>}
        </div>
        <footer><span>{pricing.data ? `规则读取于 ${new Date(pricing.data.asOf).toLocaleTimeString("zh-CN", { hour12: false })} · 以提交时的服务端结算为准` : "价格由服务端读取"}</span><button type="button" disabled={pricing.loading} onClick={() => { void pricing.refresh(); void onRefresh?.(); }}><RefreshCw size={14} />{pricing.loading ? "读取中" : "刷新"}</button></footer>
      </div>
    </div>, document.body)}
  </>;
}
