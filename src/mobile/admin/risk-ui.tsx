"use client";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { AdminButton } from "./ui/admin-primitives";

export const riskLabels: Record<string, string> = {
  normal: "正常",
  watch: "观察",
  elevated: "关注",
  risk: "中风险",
  critical: "高风险",
  severe: "严重风险",
  isolated: "紧急隔离",
  banned: "已封禁",
};
export const familyLabels: Record<string, string> = {
  behavior: "行为分布",
  network: "网络情报",
  device: "设备关联",
  quota: "额度消耗",
  content: "内容风险",
  retry: "重复尝试",
  relay: "限制规避",
  farm: "奖励套利",
};
export function RiskBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`risk-badge risk-badge-${tone}`}>{children}</span>;
}
export function RiskIdentity({ name, id }: { name?: string; id?: number }) {
  const title = name || (id ? `账号 ${id}` : "未关联账号");
  return (
    <div className="risk-identity">
      <span className="risk-avatar" aria-hidden="true">
        {Array.from(title)[0]}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{id ? `ID ${id}` : "外部请求"}</small>
      </div>
    </div>
  );
}
export function RiskSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="risk-search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function RiskPager({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (v: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size)),
    current = Math.min(page, pages);
  return (
    <div className="risk-pager">
      <span>
        共 {total} 条 · {total ? (current - 1) * size + 1 : 0}–
        {Math.min(current * size, total)}
      </span>
      <div>
        <AdminButton
          variant="icon"
          aria-label="上一页"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          <ChevronLeft size={15} />
        </AdminButton>
        <span>
          {current} / {pages}
        </span>
        <AdminButton
          variant="icon"
          aria-label="下一页"
          disabled={current >= pages}
          onClick={() => onChange(current + 1)}
        >
          <ChevronRight size={15} />
        </AdminButton>
      </div>
    </div>
  );
}
export function riskDate(value: string | number) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
