"use client";

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type LogItem = Record<string, unknown>;

export default function UsagePage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/usage?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) =>
        readJson<{ items?: LogItem[]; total?: number }>(
          response,
          "读取使用记录失败",
        ),
      )
      .then((result) => {
        setItems(result.items || []);
        setTotal(result.total || 0);
        setMessage("");
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof SessionExpiredError) setExpired(error.message);
        else
          setMessage(
            error instanceof Error ? error.message : "读取使用记录失败",
          );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page]);

  return (
    <ProductPage title="使用记录" icon={<ListFilter size={20} />}>
      {expired && <SessionExpiredNotice message={expired} />}
      {message && <Notice>{message}</Notice>}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              GENERATION LOGS
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              仅显示 NAI 生成记录 · 点击行展开计费与请求参数
            </p>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
        <div className="grid grid-cols-[minmax(140px,1fr)_100px_90px_150px_24px] gap-3 border-b border-[var(--line)] bg-[#f2f0ea] px-4 py-3 text-xs font-semibold max-sm:hidden">
          <span>模型 / 请求</span>
          <span>消耗</span>
          <span>状态</span>
          <span>时间</span>
          <span />
        </div>
        {expired ? (
          <Empty text="登录状态已过期" />
        ) : loading ? (
          <Empty text="正在读取使用记录…" />
        ) : items.length ? (
          items.map((item, index) => {
            const rowId = String(item.id || index);
            const expanded = expandedId === rowId;
            return (
              <div
                key={rowId}
                className="border-b border-[var(--line)] last:border-0"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : rowId)}
                  className="grid w-full grid-cols-[minmax(140px,1fr)_100px_90px_150px_24px] items-center gap-3 px-4 py-3 text-left text-xs hover:bg-[#f7f5ef] max-sm:grid-cols-[1fr_24px] max-sm:gap-2"
                >
                  <div className="min-w-0">
                    <b className="block truncate">
                      {String(
                        item.model_name || item.model || item.name || "未知模型",
                      )}
                    </b>
                    <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                      {String(
                        item.request_id || item.token_name || item.type || "-",
                      )}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-[var(--muted)] sm:hidden">
                      <span>消耗 {formatQuota(item.quota ?? item.cost ?? item.amount)}</span>
                      <span>{String(item.status || item.type_name || "已记录")}</span>
                      <span>
                        {formatTime(
                          item.created_at || item.createdAt || item.timestamp,
                        )}
                      </span>
                    </span>
                  </div>
                  <span className="max-sm:hidden">
                    {formatQuota(item.quota ?? item.cost ?? item.amount)}
                  </span>
                  <span className="max-sm:hidden">{String(item.status || item.type_name || "已记录")}</span>
                  <span className="max-sm:hidden">
                    {formatTime(
                      item.created_at || item.createdAt || item.timestamp,
                    )}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`justify-self-end text-[var(--muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded && <LogDetail item={item} />}
              </div>
            );
          })
        ) : (
          <Empty text="暂无使用记录" />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">
          共 {total} 条 · 第 {page} 页
        </span>
        <div className="flex gap-2">
          <button
            className="page-button"
            disabled={page <= 1}
            onClick={() => {
              setLoading(true);
              setPage((value) => value - 1);
            }}
          >
            <ChevronLeft size={15} />
            上一页
          </button>
          <button
            className="page-button"
            disabled={items.length < 20}
            onClick={() => {
              setLoading(true);
              setPage((value) => value + 1);
            }}
          >
            下一页
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </ProductPage>
  );
}

function formatTime(value: unknown) {
  if (!value) return "-";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN");
}

// NAI 生成的记录：模型名以 nai- 开头（图生图等操作的模型名一致）。
// 后端已按 model_name=nai- 过滤，此处仅作兜底。
function isNaiItem(item: LogItem): boolean {
  const model = String(item.model_name || item.model || item.name || "");
  return model.toLowerCase().startsWith("nai-");
}
void isNaiItem;

// NewAPI 返回原始 quota，除以 QUOTA_PER_UNIT(500000) 才是美元消耗。
function formatQuota(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "-";
  return `$${(numeric / 500000).toFixed(2)}`;
}

// 展开区：聚合日志行与 other 里的计费参数，分组呈现。
function LogDetail({ item }: { item: LogItem }) {
  const other = parseOther(item.other);
  const sections: Array<{ title: string; rows: [string, string][] }> = [];

  const base: [string, string][] = [
    ["模型", String(item.model_name || "-")],
    ["令牌", String(item.token_name || "-")],
    ["分组", String(item.group || "-")],
    ["渠道", item.channel_name ? `${item.channel_name} (#${item.channel_id})` : String(item.channel_id || "-")],
    ["耗时", `${Number(item.use_time || 0)} 秒`],
    ["请求 ID", String(item.request_id || "-")],
  ];
  if (item.content) base.unshift(["摘要", String(item.content)]);
  sections.push({ title: "请求信息", rows: base });

  const usage: [string, string][] = [
    ["消耗", formatQuota(item.quota ?? item.cost ?? item.amount)],
    ["prompt_tokens", String(item.prompt_tokens ?? "-")],
    ["completion_tokens", String(item.completion_tokens ?? "-")],
  ];
  if (other) {
    const billingKeys = ["group_ratio", "model_ratio", "model_price", "completion_ratio", "cache_ratio", "billing_source", "request_path"];
    for (const key of billingKeys) {
      if (other[key] !== undefined) usage.push([key, String(other[key])]);
    }
  }
  sections.push({ title: "计费与用量", rows: usage });

  if (other) {
    const extraKeys = Object.keys(other).filter(
      (key) => !["group_ratio", "model_ratio", "model_price", "completion_ratio", "cache_ratio", "billing_source", "request_path"].includes(key),
    );
    if (extraKeys.length) {
      sections.push({
        title: "其他参数",
        rows: extraKeys.map((key) => [key, String(other[key])]),
      });
    }
  }

  return (
    <div className="border-t border-[var(--line)] bg-[#f7f5ef] px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <div
            key={section.title}
            className="rounded-md border border-[var(--line)] bg-white p-3"
          >
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[var(--rose)]">
              {section.title.toUpperCase()}
            </p>
            <dl className="mt-2 space-y-1.5">
              {section.rows.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-[var(--muted)]">{key}</dt>
                  <dd className="min-w-0 truncate font-medium" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseOther(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function ProductPage({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3 text-[var(--rose)]">
          {icon}
          <b className="text-[var(--ink)]">{title}</b>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-6xl p-4 sm:p-8">{children}</section>
    </main>
  );
}
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">{text}</p>
  );
}
