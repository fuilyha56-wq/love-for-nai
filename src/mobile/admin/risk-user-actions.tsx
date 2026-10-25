"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { LfnSelect } from "@/mobile/ui/lfn-select";
import { AdminButton, AdminCard } from "./ui/admin-primitives";
import { ReferralExplorer, type ChainPreview } from "./referral-tree";

export type RiskActionUser = {
  userId: number;
  username?: string;
  score: number;
  level: string;
  signals: Array<{ id: string; description: string }>;
  enforcement?: { blocked?: boolean };
};
export default function RiskUserActions({
  user,
  initial,
  onClose,
  onChanged,
}: {
  user: RiskActionUser;
  initial: "mark" | "ban" | "chain";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState(initial),
    [reason, setReason] = useState("");
  const [level, setLevel] = useState("risk"),
    [chainAction, setChainAction] = useState("view");
  const [chain, setChain] = useState<ChainPreview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const blocked = Boolean(user.enforcement?.blocked);
  async function submit() {
    if (!reason.trim()) {
      setMessage("请填写具体操作原因");
      return;
    }
    if (kind === "chain" && (!chain || chainAction === "view")) return;
    setBusy(true);
    setMessage("");
    try {
      const action =
        kind === "mark"
          ? "mark"
          : kind === "chain"
            ? chainAction
            : blocked
              ? "unban"
              : "ban";
      const body = {
        action,
        reason,
        ...(kind === "mark"
          ? { level }
          : { scope: kind === "chain" ? "referral-chain" : "user" }),
        ...(kind === "chain"
          ? { previewUserIds: chain!.component.userIds }
          : {}),
      };
      const response = await fetch(
        `/api/admin/risk/users/${user.userId}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "风控操作失败");
      setMessage(
        `${action === "mark" ? "风险标记已更新" : action === "unban" ? "已解除封禁" : "已封禁"} · ${result.affectedUserIds?.length || 1} 个账号 · 原因：${reason}`,
      );
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "风控操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminCard
      title={`${user.username || "账号"} #${user.userId} · 风险详情`}
      actions={
        <AdminButton variant="icon" onClick={onClose} aria-label="关闭风险详情">
          <X size={16} />
        </AdminButton>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {(["mark", "ban", "chain"] as const).map((value) => (
          <AdminButton
            key={value}
            variant={kind === value ? "primary" : "secondary"}
            onClick={() => {
              setKind(value);
              setMessage("");
            }}
          >
            {value === "mark"
              ? "风险标记"
              : value === "ban"
                ? "账号封禁"
                : "邀请关系分析"}
          </AdminButton>
        ))}
      </div>
      {kind === "chain" ? (
        <ReferralExplorer userId={user.userId} onLoaded={setChain} />
      ) : (
        <div className="mb-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-6">
          <p>
            当前风险分 {user.score} · {blocked ? "已封禁" : "未封禁"}
          </p>
          {user.signals.map((signal) => (
            <p key={signal.id}>{signal.description}</p>
          ))}
          {!user.signals.length && (
            <p>暂无自动检测信号；标记时请填写人工复核依据。</p>
          )}
        </div>
      )}
      <form
        className="mt-4 space-y-3 border-t border-[var(--line)] pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {kind === "mark" && (
          <label className="flex items-center gap-3 text-xs font-semibold">
            风险等级
            <LfnSelect
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              aria-label="风险标记等级"
            >
              <option value="watch">关注</option>
              <option value="risk">风险</option>
              <option value="critical">严重风险</option>
            </LfnSelect>
          </label>
        )}
        {kind === "chain" && (
          <label className="flex flex-wrap items-center gap-3 text-xs font-semibold">
            关联账号操作
            <LfnSelect
              value={chainAction}
              onChange={(event) => setChainAction(event.target.value)}
              aria-label="邀请链操作"
            >
              <option value="view">只查看关系</option>
              <option value="ban">封禁当前主链与下游</option>
              <option value="unban">解封当前主链与下游</option>
            </LfnSelect>
          </label>
        )}
        {(kind !== "chain" || chainAction !== "view") && (
          <>
            <label className="block text-xs font-semibold">
              操作原因
              <textarea
                rows={2}
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="field mt-1.5 w-full p-3 font-normal"
                placeholder="填写检测依据、复核结果或解除原因"
              />
            </label>
            <p className="text-xs text-[var(--muted)]">
              {kind === "chain"
                ? `本次影响 ${chain?.component.userIds.length || 0} 个账号；关联旁支仅供展示。`
                : "本次仅影响当前账号。"}
              封禁会阻止这些账号在平台提交图像请求。
            </p>
            <AdminButton
              type="submit"
              variant={
                kind === "mark" || blocked || chainAction === "unban"
                  ? "primary"
                  : "danger"
              }
              loading={busy}
              disabled={!reason.trim() || (kind === "chain" && !chain)}
            >
              {kind === "mark"
                ? "确认标记"
                : kind === "chain"
                  ? `确认${chainAction === "unban" ? "解封" : "封禁"} ${chain?.component.userIds.length || 0} 个账号`
                  : blocked
                    ? "确认解封"
                    : "确认封禁"}
            </AdminButton>
          </>
        )}
        {message && (
          <p
            role="status"
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-sm"
          >
            {message}
          </p>
        )}
      </form>
    </AdminCard>
  );
}
