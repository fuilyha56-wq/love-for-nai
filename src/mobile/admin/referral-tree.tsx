"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, UserRound } from "lucide-react";
import type { ReferralRiskComponent } from "@/lib/referral";
import {
  referralAccountStatusText,
  type ReferralAccountStatus,
} from "@/lib/referral-account-status";
import { AdminButton, AdminCard } from "./ui/admin-primitives";

export type ChainPreview = {
  component: ReferralRiskComponent;
  accountProvider?: "LFN" | "NewAPI";
  users: Array<{
    userId: number;
    username: string;
    displayName?: string;
    level: string;
    score: number;
    blocked: boolean;
    accountStatus?: ReferralAccountStatus;
  }>;
};

export function ReferralExplorer({
  userId,
  onLoaded,
}: {
  userId: number;
  onLoaded?: (data: ChainPreview) => void;
}) {
  const [data, setData] = useState<ChainPreview | null>(null),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/chain-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取邀请关系失败");
        if (controller.signal.aborted) return;
        setData(result);
        onLoaded?.(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "读取邀请关系失败");
      });
    return () => controller.abort();
  }, [userId, onLoaded, revision]);
  function refresh() {
    setError("");
    setData(null);
    setRevision((value) => value + 1);
  }
  if (error)
    return (
      <div className="space-y-2">
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
        <AdminButton onClick={refresh}>重试读取账号状态</AdminButton>
      </div>
    );
  if (!data || data.component.rootUserId !== userId)
    return (
      <p role="status" className="py-6 text-sm text-[var(--muted)]">
        正在读取邀请关系…
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AdminButton onClick={refresh}>刷新账号状态</AdminButton>
      </div>
      <ReferralTree key={userId} data={data} />
    </div>
  );
}

export function ReferralTree({ data }: { data: ChainPreview }) {
  const { component, users } = data;
  const [selected, setSelected] = useState(component.rootUserId);
  const [mode, setMode] = useState<"tree" | "chain">("tree");
  const [expanded, setExpanded] = useState(
    () => new Set([component.rootUserId, ...component.ancestors]),
  );
  const names = new Map(users.map((item) => [item.userId, item]));
  const edges = component.contextEdges || component.edges;
  const children = useMemo(() => {
    const map = new Map<number, typeof edges>();
    for (const edge of edges) {
      const list = map.get(edge.inviterUserId) || [];
      list.push(edge);
      map.set(edge.inviterUserId, list);
    }
    return map;
  }, [edges]);
  const incoming = edges.find((edge) => edge.registeredUserId === selected);
  const current = names.get(selected);
  const affected = new Set(component.userIds);
  const ids = component.contextUserIds || component.userIds;
  const parentIds = new Set(edges.map((edge) => edge.registeredUserId));
  const roots = ids.filter((id) => !parentIds.has(id));
  const rootIds = roots.length
    ? roots
    : [component.ancestors.at(-1) || component.rootUserId];
  function node(id: number, path: Set<number>, depth: number): React.ReactNode {
    const person = names.get(id);
    if (path.has(id))
      return (
        <li key={`cycle-${id}`} className="text-xs text-amber-700">
          ↩ #{id} 循环关系
        </li>
      );
    const nextPath = new Set([...path, id]);
    const branches = children.get(id) || [];
    const open = expanded.has(id);
    return (
      <li key={id}>
        <div
          className={`referral-node ${id === selected ? "is-selected" : ""} ${id === component.rootUserId ? "is-root" : ""}`}
        >
          {branches.length ? (
            <button
              type="button"
              aria-label={`${open ? "收起" : "展开"}账号 ${id} 的下游`}
              aria-expanded={open}
              onClick={() =>
                setExpanded((value) => {
                  const next = new Set(value);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <UserRound size={14} className="text-[var(--muted)]" />
          )}
          <button
            type="button"
            onClick={() => setSelected(id)}
            className="min-w-0 flex-1 text-left"
          >
            <b>{person?.displayName || person?.username || `账号 #${id}`}</b>
            <small>
              #{id}
              {id === component.rootUserId
                ? " · 当前账号"
                : component.ancestors.includes(id)
                  ? " · 上游邀请人"
                  : component.descendants.includes(id)
                    ? " · 下游被邀请人"
                    : " · 关联分支"}
              {person?.accountStatus === "disabled"
                ? ` · ${data.accountProvider || "账号"} 已禁用`
                : person?.accountStatus !== "active"
                  ? " · 账号状态未知"
                  : ""}
              {person?.blocked ? " · LFN 风控封禁" : ""}
            </small>
          </button>
          {branches.length > 0 && (
            <span className="text-[10px] text-[var(--muted)]">
              {branches.length} 分支
            </span>
          )}
        </div>
        {open && branches.length > 0 && depth < 100 && (
          <ul>
            {branches.map((edge) =>
              node(edge.registeredUserId, nextPath, depth + 1),
            )}
          </ul>
        )}
      </li>
    );
  }
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <AdminButton
            variant={mode === "tree" ? "primary" : "secondary"}
            onClick={() => setMode("tree")}
          >
            <GitBranch size={14} />
            关系树
          </AdminButton>
          <AdminButton
            variant={mode === "chain" ? "primary" : "secondary"}
            onClick={() => setMode("chain")}
          >
            上游主链
          </AdminButton>
        </div>
        <p className="text-xs text-[var(--muted)]">
          上游 {component.ancestors.length} · 下游{" "}
          {component.descendants.length} · 操作范围 {affected.size} 个账号
        </p>
      </div>
      {component.cycleDetected && (
        <p className="text-xs text-amber-700">
          存在循环邀请关系，已停止重复展开，请核对注册来源。
        </p>
      )}
      {component.truncated && (
        <p className="text-xs text-amber-700">
          已按最大深度或 1000 个账号限制展示，请选择分支账号继续查看。
        </p>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(240px,1fr)]">
        <div className="referral-tree-scroll" aria-label="邀请关系分析">
          {mode === "tree" ? (
            <ul className="referral-tree">
              {rootIds.map((id) => node(id, new Set(), 0))}
            </ul>
          ) : (
            <ol className="space-y-2">
              {[...component.ancestors]
                .reverse()
                .concat(component.rootUserId)
                .map((id, index) => (
                  <li key={id}>
                    <button
                      type="button"
                      className={`referral-node w-full ${selected === id ? "is-selected" : ""}`}
                      onClick={() => setSelected(id)}
                    >
                      {index > 0 ? "↓ 邀请 → " : "源头 · "}
                      {names.get(id)?.displayName ||
                        names.get(id)?.username ||
                        `账号 #${id}`}{" "}
                      · #{id}
                    </button>
                  </li>
                ))}
              <li className="pt-2 text-xs text-[var(--muted)]">
                当前账号有 {component.descendants.length}{" "}
                个下游账号；切到关系树查看完整分支。
              </li>
            </ol>
          )}
        </div>
        <AdminCard
          title={`${current?.displayName || current?.username || "账号"} #${selected}`}
          description={
            affected.has(selected)
              ? "位于当前主链或下游操作范围"
              : "关联旁支，仅供分析，不在当前批量操作范围"
          }
        >
          <dl className="space-y-3 break-all text-xs leading-5">
            <div>
              <dt className="text-[var(--muted)]">邀请人</dt>
              <dd>
                {incoming
                  ? `${names.get(incoming.inviterUserId)?.username || "账号"} #${incoming.inviterUserId}`
                  : "当前记录中没有上游邀请人"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">注册时间 · 北京时间</dt>
              <dd>
                {incoming?.registeredAt
                  ? new Date(incoming.registeredAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })
                  : "旧邀请记录未保存注册时间"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">来源邀请码</dt>
              <dd>{incoming?.code || "无上游邀请码"}</dd>
            </div>
            {incoming?.invitationLink && (
              <div>
                <dt className="text-[var(--muted)]">邀请链接</dt>
                <dd>{incoming.invitationLink}</dd>
              </div>
            )}
            {incoming?.landingPath && (
              <div>
                <dt className="text-[var(--muted)]">落地路径</dt>
                <dd>{incoming.landingPath}</dd>
              </div>
            )}
            {incoming?.referer && (
              <div>
                <dt className="text-[var(--muted)]">进入来源</dt>
                <dd>{incoming.referer}</dd>
              </div>
            )}
            {incoming?.requestId && (
              <div>
                <dt className="text-[var(--muted)]">注册请求 ID</dt>
                <dd className="font-mono">{incoming.requestId}</dd>
              </div>
            )}
            <div>
              <dt className="text-[var(--muted)]">
                {data.accountProvider || "登录"} 账号状态
              </dt>
              <dd>{referralAccountStatusText(current?.accountStatus)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">LFN 风控状态</dt>
              <dd>
                {current?.blocked ? "已封禁" : "无本地封禁记录"} · 分数{" "}
                {current?.score || 0}
              </dd>
            </div>
          </dl>
        </AdminCard>
      </div>
    </div>
  );
}
