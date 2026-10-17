"use client";
import { Fragment, useEffect, useState } from "react";
import { AdminButton, AdminCard } from "./ui/admin-primitives";
import { ReferralExplorer } from "./referral-tree";
type Row = {
  code: string;
  inviterUserId: number;
  inviterName?: string;
  invitedCount: number;
  createdAt: string;
};
export default function ReferralsPanel() {
  const [items, setItems] = useState<Row[]>([]),
    [reward, setReward] = useState(0),
    [selected, setSelected] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/referrals", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取邀请记录失败");
        setItems(result.items || []);
        setReward(result.reward);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, []);
  const visible = items.filter((item) =>
    `${item.code} ${item.inviterUserId} ${item.inviterName || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <AdminCard
        title="邀请溯源"
        description={`邀请双方各得 ${reward} 创作额度。选择邀请码查看源头、当前账号、下游分支和注册请求来源。`}
      >
        <input
          className="field mb-4 w-full p-2.5"
          aria-label="搜索邀请码或邀请人"
          placeholder="搜索邀请码、邀请人或用户 ID…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--line)] text-[var(--muted)]">
              <tr>
                <th className="p-2">邀请人</th>
                <th className="p-2">邀请码</th>
                <th className="p-2">直接邀请</th>
                <th className="p-2">创建时间</th>
                <th className="p-2">溯源</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <Fragment key={item.code}>
                  <tr className="border-b border-[var(--line)]">
                    <td className="p-2.5">
                      {item.inviterName || `账号 #${item.inviterUserId}`}
                    </td>
                    <td className="p-2.5 font-mono">{item.code}</td>
                    <td className="p-2.5">{item.invitedCount} 人</td>
                    <td className="p-2.5">
                      {new Date(item.createdAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </td>
                    <td className="p-2.5">
                      <AdminButton
                        variant={
                          selected === item.inviterUserId
                            ? "primary"
                            : "secondary"
                        }
                        aria-expanded={selected === item.inviterUserId}
                        onClick={() =>
                          setSelected(
                            selected === item.inviterUserId
                              ? null
                              : item.inviterUserId,
                          )
                        }
                      >
                        {selected === item.inviterUserId
                          ? "收起关系树"
                          : "查看关系树"}
                      </AdminButton>
                    </td>
                  </tr>
                  {selected === item.inviterUserId && (
                    <tr>
                      <td
                        colSpan={5}
                        className="border-b border-[var(--line)] bg-[var(--surface-muted)] p-3"
                      >
                        <AdminCard
                          title={`${item.inviterName || `账号 #${selected}`} 的邀请关系`}
                        >
                          <ReferralExplorer key={selected} userId={selected} />
                        </AdminCard>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!visible.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    暂无匹配的邀请记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
