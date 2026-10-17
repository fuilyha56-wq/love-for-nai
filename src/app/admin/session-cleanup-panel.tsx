"use client";
import { useEffect, useState } from "react";
import { LfnSwitch } from "@/app/ui/lfn-switch";
import { AdminButton, AdminCard } from "./ui/admin-primitives";
import type {
  SessionCleanupPolicy,
  SessionCleanupReport,
} from "@/lib/session-cleanup";
type Status = {
  configured: boolean;
  policy: SessionCleanupPolicy;
  report?: SessionCleanupReport;
  nextRunAt?: string;
};

export default function SessionCleanupPanel({
  onCleaned,
}: {
  onCleaned?: () => void;
}) {
  const [data, setData] = useState<Status | null>(null),
    [policy, setPolicy] = useState<SessionCleanupPolicy | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/sessions/cleanup", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setData(result);
        setPolicy(result.policy);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  async function action(method: "PUT" | "POST") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/sessions/cleanup", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify(policy) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setData(result);
      setPolicy(result.policy);
      setMessage(
        method === "PUT" ? "自动清理设置已保存" : "闲置会话检查已完成",
      );
      if (method === "POST") onCleaned?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminCard
      title="自动清理闲置会话"
      description="按 NewAPI 的最后活动时间检测；撤销长时间未使用及已过期的会话，保留撤销记录供审计。"
    >
      {message && (
        <p role="status" className="mb-3 text-sm text-[var(--rose)]">
          {message}
        </p>
      )}
      {policy && (
        <fieldset disabled={busy || !data?.configured} className="space-y-3">
          <LfnSwitch
            disabled={busy || !data?.configured}
            checked={policy.enabled}
            label="启用定期清理"
            onChange={(enabled) => setPolicy({ ...policy, enabled })}
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold">
              闲置时限（小时）
              <input
                type="number"
                min={1}
                max={8760}
                value={policy.idleHours}
                className="field mt-1 block w-36 p-2"
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    idleHours: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-xs font-semibold">
              检查间隔（分钟）
              <input
                type="number"
                min={5}
                max={1440}
                value={policy.intervalMinutes}
                className="field mt-1 block w-36 p-2"
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    intervalMinutes: Number(event.target.value),
                  })
                }
              />
            </label>
            <AdminButton variant="primary" onClick={() => void action("PUT")}>
              保存设置
            </AdminButton>
            <AdminButton onClick={() => void action("POST")}>
              立即检查
            </AdminButton>
          </div>
        </fieldset>
      )}
      {data && !data.configured && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          此环境尚未接入 NewAPI 会话数据库。
        </p>
      )}
      {data?.report && (
        <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
          最近检查：
          {new Date(data.report.checkedAt).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })}{" "}
          · 闲置撤销 {data.report.idleRevoked} · 过期撤销{" "}
          {data.report.expiredRevoked} · 待清理 {data.report.remainingIdle}
          {data.report.error ? ` · ${data.report.error}` : ""}
        </p>
      )}
      {data?.nextRunAt && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          下一次检查：
          {new Date(data.nextRunAt).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })}
        </p>
      )}
    </AdminCard>
  );
}
