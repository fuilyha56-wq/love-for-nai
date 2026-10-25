"use client";

import Link from "next/link";
import { ArrowLeft, Coins, Globe2, Save, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Transaction = {
  id: string;
  createdAt: string;
  amount: number;
  type: string;
  description: string;
  source?: string;
  origin?: string;
};
type Detail = {
  userId: number;
  username?: string;
  displayName?: string;
  balance: number;
  packageBalance: number;
  totalBalance: number;
  sourceTotals?: Record<string, number>;
  transactions: Transaction[];
  transactionTotal: number;
  page: number;
  pageSize: number;
  usage?: {
    requests5h: number;
    requests7d: number;
    requests30d: number;
    retainedRecords: number;
  };
};
type UserIp = {
  evidenceId: string;
  requestId: string;
  family: string;
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  masked: string;
  ip?: string;
  sessionCount?: number;
  sources?: string[];
  geo?: {
    status?: "resolved" | "private" | "unavailable";
    message?: string;
    queriedAt?: string;
    provider?: string;
    isp?: string;
    countryName?: string;
    region?: string;
    city?: string;
    asn?: string;
    organization?: string;
  };
};

export default function UserLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [userId, setUserId] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ips, setIps] = useState<UserIp[]>([]);
  const [rawRevealEnabled, setRawRevealEnabled] = useState(false);
  const [personalDelta, setPersonalDelta] = useState("0");
  const [packageDelta, setPackageDelta] = useState("0");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [ipMessage, setIpMessage] = useState("");
  const [refreshingIps, setRefreshingIps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const load = useCallback(async (id: number, ledgerPage = 1) => {
    setLoading(true);
    try {
      const [ledgerResponse, ipResponse] = await Promise.all([
        fetch(`/api/admin/credits?userId=${id}&page=${ledgerPage}`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/credits/users/${id}/ips`, { cache: "no-store" }),
      ]);
      const ledger = await ledgerResponse.json();
      const ip = await ipResponse.json();
      if (!ledgerResponse.ok) throw new Error(ledger.message || "账本读取失败");
      if (!ipResponse.ok) throw new Error(ip.message || "IP 读取失败");
      setDetail(ledger.item);
      setPage(ledgerPage);
      setIps(ip.items || []);
      setRawRevealEnabled(ip.rawRevealEnabled === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账本读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void params.then((value) => {
      const id = Number(value.id);
      setUserId(id);
      if (Number.isInteger(id) && id > 0) void load(id);
    });
  }, [load, params]);

  async function adjust() {
    if (!detail) return;
    const personal = Number(personalDelta);
    const pack = Number(packageDelta);
    if (
      ![personal, pack].every(
        (value) =>
          Number.isFinite(value) &&
          Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-6,
      )
    ) {
      setMessage("调整金额最多四位小数");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/credits/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          personalDelta: personal,
          packageDelta: pack,
          description: note,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "调整失败");
      setPersonalDelta("0");
      setPackageDelta("0");
      setNote("");
      setMessage("额度调整已写入");
      await load(userId, page);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "调整失败");
    } finally {
      setSaving(false);
    }
  }

  async function revealAllIps() {
    if (!userId || !reason.trim()) {
      setIpMessage("请先填写完整 IP 查询原因");
      return;
    }
    setRevealing(true);
    try {
      const response = await fetch(`/api/admin/credits/users/${userId}/ips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "完整 IP 查询失败");
      setIps(result.items || []);
      setIpMessage(
        `已查询 ${result.items?.length || 0} 个完整 IP，${result.geoResolvedCount || 0} 个已有归属地，并记录管理员操作`,
      );
    } catch (error) {
      setIpMessage(error instanceof Error ? error.message : "完整 IP 查询失败");
    } finally {
      setRevealing(false);
    }
  }

  async function refreshIps() {
    setRefreshingIps(true);
    setIpMessage("");
    try {
      const response = await fetch(`/api/admin/credits/users/${userId}/ips`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "查询失败");
      setIps(result.items || []);
      setIpMessage(
        `已更新 ${result.total || 0} 个 IP 的记录，${result.geoResolvedCount || 0} 个已有归属地。`,
      );
    } catch (error) {
      setIpMessage(error instanceof Error ? error.message : "归属地查询失败");
    } finally {
      setRefreshingIps(false);
    }
  }
  return (
    <main className="admin-shell min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/admin?tab=credits"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--rose)] hover:underline"
            >
              <ArrowLeft size={14} />
              返回额度账本
            </Link>
            <h1 className="mt-3 text-xl font-semibold">用户个人流水与 IP</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              用户 {detail?.displayName || detail?.username || userId}（ID{" "}
              {userId}）的 AFF 账本、调用保留统计和全部 IP 证据。
            </p>
          </div>
        </div>
        {message && (
          <p
            role="status"
            className="rounded border border-[var(--line)] bg-white px-3 py-2 text-sm"
          >
            {message}
          </p>
        )}
        {loading && (
          <p className="rounded-lg border border-[var(--line)] bg-white p-6 text-sm text-[var(--muted)]">
            正在读取用户账本…
          </p>
        )}
        {detail && (
          <>
            <section className="rounded-lg border border-[var(--line)] bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f5f3ed] text-[var(--rose)]">
                  <Coins size={17} />
                </span>
                <div>
                  <h2 className="text-base font-semibold">额度概览与调整</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    个人 {detail.balance} · 图包 {detail.packageBalance} · 合计{" "}
                    {detail.totalBalance}；NewAPI quota 不计入此处。
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold">
                  个人 AFF 调整
                  <input
                    value={personalDelta}
                    onChange={(event) => setPersonalDelta(event.target.value)}
                    className="field mt-1.5 h-10 w-full px-3 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold">
                  图包 AFF 调整
                  <input
                    value={packageDelta}
                    onChange={(event) => setPackageDelta(event.target.value)}
                    className="field mt-1.5 h-10 w-full px-3 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold sm:col-span-2">
                  备注
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="field mt-1.5 h-10 w-full px-3 text-sm"
                    placeholder="可选"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void adjust()}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Save size={15} />
                {saving ? "写入中…" : "写入调整"}
              </button>
            </section>
            <section className="rounded-lg border border-[var(--line)] bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f5f3ed] text-[var(--rose)]">
                  <Coins size={17} />
                </span>
                <div>
                  <h2 className="text-base font-semibold">个人流水</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    每页显示 10 条，共 {detail.transactionTotal} 条 AFF
                    交易，按时间倒序展示。
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {detail.transactions.map((item) => (
                  <article
                    key={item.id}
                    className="rounded border border-[var(--line)] bg-[#fffefa] px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <b
                        className={
                          item.amount >= 0
                            ? "text-[var(--mint)]"
                            : "text-[var(--rose)]"
                        }
                      >
                        {item.amount >= 0 ? "+" : ""}
                        {item.amount}
                      </b>
                      <time className="text-[var(--muted)]">
                        {new Date(item.createdAt).toLocaleString("zh-CN")}
                      </time>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {item.description} · {item.type}
                      {item.source ? ` · ${item.source}` : ""}
                      {item.origin ? ` · ${item.origin}` : ""}
                    </p>
                  </article>
                ))}
                {!detail.transactions.length && (
                  <p className="py-8 text-center text-sm text-[var(--muted)]">
                    暂无流水
                  </p>
                )}
              </div>
              {detail.transactionTotal > 10 && (
                <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                  <button
                    type="button"
                    className="lfn-button"
                    disabled={loading || page <= 1}
                    onClick={() => void load(userId, page - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    第 {page} / {Math.ceil(detail.transactionTotal / 10)} 页
                  </span>
                  <button
                    type="button"
                    className="lfn-button"
                    disabled={loading || page * 10 >= detail.transactionTotal}
                    onClick={() => void load(userId, page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </section>
            <section
              id="ips"
              className="rounded-lg border border-[var(--line)] bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f5f3ed] text-[var(--rose)]">
                    <Globe2 size={17} />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">
                      用户使用过的全部 IP
                    </h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      IP
                      数量、脱敏证据和归属地直接显示；完整地址查询需填写原因。归属地使用本地地址库，包含
                      LFN 请求及 NewAPI 登录、调用的现有记录。
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted)]">
                    已记录 {ips.length} 个 IP
                  </span>
                  <button
                    type="button"
                    disabled={refreshingIps || revealing}
                    onClick={() => void refreshIps()}
                    className="lfn-button"
                  >
                    {refreshingIps ? "查询中…" : "刷新 IP 与归属地"}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 rounded border border-amber-200 bg-amber-50 p-3">
                <label className="text-xs font-semibold text-amber-950">
                  完整 IP 查询原因
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="field mt-1.5 h-9 w-full bg-white px-3 text-sm"
                    placeholder="例如：核对同账号异常登录来源"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] leading-5 text-amber-900">
                    {rawRevealEnabled
                      ? "完整地址仅在填写原因后查询，并写入管理员审计。"
                      : "当前生产配置未启用完整 IP 解密；仍可查看脱敏证据和归属地。"}
                  </p>
                  <button
                    type="button"
                    disabled={!rawRevealEnabled || revealing || !reason.trim()}
                    onClick={() => void revealAllIps()}
                    className="inline-flex h-9 items-center gap-2 rounded border border-amber-400 bg-white px-3 text-xs font-semibold text-amber-950 disabled:opacity-50"
                  >
                    <ShieldAlert size={14} />
                    {revealing ? "查询中…" : "查询完整 IP 与归属地"}
                  </button>
                </div>
              </div>
              {ipMessage && (
                <p
                  role="status"
                  className="mt-3 rounded border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs"
                >
                  {ipMessage}
                </p>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="border-b border-[var(--line)] bg-[#f5f3ed] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2.5">IP / 地址族</th>
                      <th className="px-3 py-2.5">请求次数</th>
                      <th className="px-3 py-2.5">首次出现</th>
                      <th className="px-3 py-2.5">最近出现</th>
                      <th className="px-3 py-2.5">归属地</th>
                      <th className="px-3 py-2.5">请求 ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((item) => (
                      <tr
                        key={item.evidenceId}
                        className="border-b border-[var(--line)] last:border-0"
                      >
                        <td className="px-3 py-2.5 font-mono">
                          {item.ip || item.masked}
                          <p className="mt-1 font-sans text-[10px] text-[var(--muted)]">
                            {item.family} · {item.sources?.join(" / ")}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {item.requestCount}
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            登录 {item.sessionCount || 0} 次
                          </p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-[var(--muted)]">
                          {new Date(item.firstSeenAt).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-[var(--muted)]">
                          {new Date(item.lastSeenAt).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-3 py-2.5">
                          {[
                            ...new Set(
                              [
                                item.geo?.countryName,
                                item.geo?.region,
                                item.geo?.city,
                                item.geo?.isp,
                                item.geo?.organization,
                              ].filter(Boolean),
                            ),
                          ].join(" / ") ||
                            item.geo?.message ||
                            "归属地暂不可用"}
                          {item.geo?.queriedAt && (
                            <p className="mt-1 text-[10px] text-[var(--muted)]">
                              {item.geo.provider === "ip2region"
                                ? "离线地址库"
                                : "地址类型"}{" "}
                              ·{" "}
                              {new Date(item.geo.queriedAt).toLocaleString(
                                "zh-CN",
                              )}
                            </p>
                          )}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-[10px] text-[var(--muted)]">
                          {item.requestId}
                        </td>
                      </tr>
                    ))}
                    {!ips.length && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                        >
                          没有找到该用户的 IP 证据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
