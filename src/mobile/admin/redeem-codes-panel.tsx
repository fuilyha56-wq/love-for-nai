"use client";
import { LfnDateInput } from "@/mobile/ui/lfn-date-input";

import { useCallback, useEffect, useRef, useState } from "react";

type RedeemCode = {
  source?: "lfn" | "newapi";
  name?: string;
  quota?: number;
  status?: number;
  redeemedAt?: string;
  usedUserId?: number;
  createdBy?: number;
  id: string;
  code: string;
  amount: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  enabled: boolean;
  createdAt: string;
};
export default function RedeemCodesPanel() {
  const loadSequence = useRef(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const [source, setSource] = useState<"lfn" | "newapi">("lfn");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [items, setItems] = useState<RedeemCode[]>([]);
  const [count, setCount] = useState("1");
  const [amount, setAmount] = useState("100");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [code, setCode] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [history, setHistory] = useState<
    { code: string; amount: number; rewardType?: string; redeemedAt: string }[]
  >([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sequence=++loadSequence.current;
    try {
      const response = await fetch(
        `/api/admin/redeem-codes?source=${source}&page=${page}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if(sequence!==loadSequence.current)return;
      if (!response.ok) throw new Error(result.message || "兑换码读取失败");
      setItems(result.items || []);
      setCheckedAt(Date.now());
      setTotal(result.total || 0);
      if (source === "newapi" && result.available === false)
        setMessage("当前账号提供者未接入 NewAPI 数据库");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "兑换码读取失败");
    }
  }, [source, page]);
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function create() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/redeem-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: Number(count),
          amount: Number(amount),
          maxUses: Number(maxUses),
          expiresAt: expiresAt || undefined,
          code: code || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建失败");
      setMessage(`已创建 ${result.items?.length || 0} 个兑换码`);
      setCode("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: RedeemCode) {
    try {
      const response = await fetch("/api/admin/redeem-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      const result = await response.json();
      if (!response.ok) setMessage(result.message || "更新失败");
      else await load();
    } catch {
      setMessage("更新失败，请重试");
    }
  }
  async function redeem() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: redeemCode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "兑换失败");
      setMessage(result.message || "兑换成功");
      setRedeemCode("");
      const historyResponse = await fetch("/api/redeem/history", {
        cache: "no-store",
      });
      const historyResult = await historyResponse.json();
      setHistory(historyResult.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "兑换失败");
    } finally {
      setBusy(false);
    }
  }
  async function reveal(item: RedeemCode) {
    try {
      const response = await fetch("/api/admin/redeem-codes/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "读取失败");
      setRevealed((current) => ({ ...current, [item.id]: result.code }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败");
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"
      aria-labelledby="redeem-codes-panel-title"
    >
      <div>
        <h2 id="redeem-codes-panel-title" className="text-base font-semibold">
          兑换码
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          同步 LFN 与 NewAPI 兑换码。LFN 奖励进入个人 AFF；NewAPI
          奖励进入上游余额，保留原有额度单位。
        </p>
      </div>
      <nav className="flex gap-2" aria-label="兑换码来源">
        {(["lfn", "newapi"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={source === value}
            className={`lfn-button ${source === value ? "is-primary" : ""}`}
            onClick={() => {
              setSource(value);
              setPage(1);
                  setItems([]);
                  setTotal(0);
              setMessage("");
            }}
          >
            {value === "lfn" ? "LFN 创作额度" : "NewAPI 余额"}
          </button>
        ))}
      </nav>
      {message && (
        <p className="rounded border border-[var(--line)] bg-white px-3 py-2 text-sm">
          {message}
        </p>
      )}
      {source === "lfn" && (
        <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-white p-4 sm:grid-cols-4">
          <label className="text-xs font-semibold">
            数量
            <input
              className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="text-xs font-semibold">
            每码 AFF
            <input
              className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="text-xs font-semibold">
            每码次数
            <input
              className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal"
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="text-xs font-semibold">
            自定义码
            <input
              className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="可选"
            />
          </label>
          <label className="text-xs font-semibold sm:col-span-3">
            过期时间
            <LfnDateInput
              type="datetime-local"
              className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="h-9 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            生成兑换码
          </button>
        </div>
      )}
      <div className="flex gap-2 rounded-lg border border-[var(--line)] bg-white p-4">
        <input
          className="h-9 min-w-0 flex-1 rounded border border-[var(--line)] px-2 text-sm"
          value={redeemCode}
          onChange={(event) => setRedeemCode(event.target.value)}
          placeholder="输入 LFN 或 NewAPI 兑换码（兑换到当前账号）"
        />
        <button
          type="button"
          disabled={busy || !redeemCode}
          onClick={() => void redeem()}
          className="h-9 rounded border border-[var(--line)] px-3 text-xs font-semibold"
        >
          兑换
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-[#f5f3ed] text-[var(--muted)]">
            <tr>
              {[
                "名称 / 兑换码",
                "额度",
                "使用",
                "创建时间",
                "失效时间",
                "状态",
                "操作",
              ].map((label) => (
                <th key={label} className="px-3 py-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-[var(--line)]">
                <td className="px-3 py-2">
                  <b>{item.name || "LFN 兑换码"}</b>
                  <p className="mt-1 break-all font-mono">
                    {revealed[item.id] || item.code}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[var(--rose)]"
                    aria-expanded={expanded === item.id}
                    onClick={() =>
                      setExpanded(expanded === item.id ? null : item.id)
                    }
                  >
                    {expanded === item.id ? "收起详情" : "查看详情"}
                  </button>
                  {expanded === item.id && (
                    <dl className="mt-2 space-y-1 text-[var(--muted)]">
                      <div>
                        <button
                          type="button"
                          className="lfn-button"
                          onClick={() =>
                            revealed[item.id]
                              ? setRevealed((current) => {
                                  const next = { ...current };
                                  delete next[item.id];
                                  return next;
                                })
                              : void reveal(item)
                          }
                        >
                          {revealed[item.id]
                            ? "隐藏完整兑换码"
                            : "查看完整兑换码"}
                        </button>
                      </div>
                      <div>ID：{item.id}</div>
                      <div>创建者：{item.createdBy || "未保留"}</div>
                      <div>兑换者：{item.usedUserId || "未兑换"}</div>
                      <div>
                        兑换时间：
                        {item.redeemedAt
                          ? new Date(item.redeemedAt).toLocaleString("zh-CN")
                          : "未兑换"}
                      </div>
                      {item.quota !== undefined && (
                        <div>原始 quota：{item.quota}</div>
                      )}
                    </dl>
                  )}
                </td>
                <td className="px-3 py-2">
                  {item.amount} {item.source === "newapi" ? "NewAPI $" : "AFF"}
                </td>
                <td className="px-3 py-2">
                  {item.usedCount}/{item.maxUses}
                </td>
                <td className="px-3 py-2">
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleString("zh-CN")
                    : "未保留"}
                </td>
                <td className="px-3 py-2">
                  {item.expiresAt
                    ? new Date(item.expiresAt).toLocaleString("zh-CN")
                    : "永不过期"}
                </td>
                <td className="px-3 py-2">
                  {item.usedCount >= item.maxUses
                    ? "已用完"
                    : item.expiresAt && Date.parse(item.expiresAt) <= checkedAt
                      ? "已过期"
                      : item.enabled
                        ? "启用"
                        : "停用"}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={item.usedCount >= item.maxUses}
                    onClick={() => void toggle(item)}
                    className="lfn-button disabled:opacity-50"
                  >
                    {item.enabled ? "停用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-[var(--muted)]"
                >
                  暂无兑换码
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="lfn-button"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <span>
          共 {total} 个 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页
        </span>
        <button
          type="button"
          className="lfn-button"
          disabled={page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
      {history.length > 0 && (
        <div className="rounded-lg border border-[var(--line)] bg-white p-3 text-xs">
          <b>兑换历史</b>
          {history.map((item) => (
            <p
              key={`${item.code}-${item.redeemedAt}`}
              className="mt-2 text-[var(--muted)]"
            >
              {item.code} · {item.amount}{" "}
              {item.rewardType === "newapi-quota" ? "NewAPI $" : "AFF"} ·{" "}
              {new Date(item.redeemedAt).toLocaleString("zh-CN")}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
