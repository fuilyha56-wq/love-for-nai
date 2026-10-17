"use client";
import { useEffect, useState } from "react";
import { AdminButton, AdminEmptyState } from "./ui/admin-primitives";
import { RiskBadge, RiskPager, riskDate } from "./risk-ui";
import type { RiskAccessRequest } from "@/lib/risk-access";
export default function RiskAccessPanel() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("pending");
  const [entries, setEntries] = useState<RiskAccessRequest[]>([]),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/admin/risk/access", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    setEntries(result.requests);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/access", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "申请读取失败");
        return result;
      })
      .then((result) => setEntries(result.requests))
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  async function decide(id: string, action: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/risk/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      await load();
      setMessage("审批已记录；仅变更对应的限时调用权限");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "审批失败");
    } finally {
      setBusy(false);
    }
  }

  const labels: Record<string, string> = {
    pending: "待审批",
    approved: "已批准",
    declined: "未批准",
    revoked: "已撤销",
    expired: "已到期",
  };
  const visible = entries.filter((e) => !filter || e.status === filter);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(visible.length / 10)),
  );
  return (
    <div>
      <div className="risk-heading">
        <div>
          <h3 className="risk-section-title">高频申请与限时批准</h3>
          <p className="risk-muted">
            根据账号的使用目的审批，仅调整本次申请对应的调用权限。
          </p>
        </div>
        <RiskBadge tone="warning">
          {entries.filter((e) => e.status === "pending").length} 项待审
        </RiskBadge>
      </div>
      <div className="risk-inline my-4">
        {["pending", "approved", ""].map((status) => (
          <AdminButton
            key={status}
            variant={filter === status ? "primary" : "secondary"}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
          >
            {status ? labels[status] : "全部申请"}
          </AdminButton>
        ))}
      </div>
      <label className="risk-input-label mb-4">
        本次审批原因
        <input
          className="risk-input"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="填写批准、拒绝或撤销的具体原因"
        />
      </label>
      {!visible.length && (
        <AdminEmptyState>当前分类下没有高频申请。</AdminEmptyState>
      )}
      <div className="risk-overrides">
        {visible.slice((currentPage - 1) * 10, currentPage * 10).map((e) => (
          <article key={e.id} className="risk-override">
            <div className="risk-override-head">
              <strong className="text-sm">账号 ID {e.userId}</strong>
              <RiskBadge
                tone={
                  e.status === "approved"
                    ? "success"
                    : e.status === "pending"
                      ? "warning"
                      : "neutral"
                }
              >
                {labels[e.status] || e.status}
              </RiskBadge>
            </div>
            <div className="risk-inline">
              <RiskBadge>{e.perMinute} 次/分钟</RiskBadge>
              <RiskBadge>并发 {e.concurrency}</RiskBadge>
              <RiskBadge>有效 {e.hours} 小时</RiskBadge>
            </div>
            <p className="my-3 text-xs leading-6 whitespace-pre-wrap break-words">
              {e.reason}
            </p>
            {e.expiresAt && (
              <p className="risk-muted">到期 {riskDate(e.expiresAt)}</p>
            )}
            <div className="risk-inline mt-3">
              {(e.status === "pending"
                ? ["approve", "decline"]
                : e.status === "approved"
                  ? ["revoke"]
                  : []
              ).map((action) => (
                <AdminButton
                  key={action}
                  variant={action === "approve" ? "primary" : "secondary"}
                  disabled={busy || !reason.trim()}
                  onClick={() => void decide(e.id, action)}
                >
                  {action === "approve"
                    ? "限时批准"
                    : action === "decline"
                      ? "不予批准"
                      : "撤销此项权限"}
                </AdminButton>
              ))}
            </div>
          </article>
        ))}
      </div>
      {!!visible.length && (
        <RiskPager
          page={currentPage}
          total={visible.length}
          size={10}
          onChange={setPage}
        />
      )}
      {message && (
        <p role="status" className="risk-message mt-4">
          {message}
        </p>
      )}
    </div>
  );
}
