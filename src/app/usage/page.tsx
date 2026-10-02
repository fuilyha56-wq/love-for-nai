"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ListFilter, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type LogItem = Record<string, unknown>;
type DateRange = { start: string; end: string };

function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// 本地时区：start 取当天 00:00，end 取当天 23:59:59（unix 秒）。
function dateToStartSeconds(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}
function dateToEndSeconds(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59, 999).getTime() / 1000);
}

function presetRange(days: number): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: toDateString(start), end: toDateString(end) };
}

export default function UsagePage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 日期范围：默认最近 7 天（服务端同样默认 7 天并钳位到 90 天上限）。
  const [range, setRange] = useState<DateRange>(() => presetRange(7));
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/usage?page=${page}&start=${dateToStartSeconds(range.start)}&end=${dateToEndSeconds(range.end)}`, {
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
  }, [page, range, reloadToken]);

  function applyPreset(days: number) {
    setLoading(true);
    setPage(1);
    setRange(presetRange(days));
  }

  function changeDate(part: "start" | "end", value: string) {
    if (!value) return;
    setLoading(true);
    setPage(1);
    setRange((current) => {
      const next = { ...current, [part]: value };
      if (dateToStartSeconds(next.start) > dateToEndSeconds(next.end)) {
        return part === "start" ? { ...next, end: next.start } : { ...next, start: next.end };
      }
      return next;
    });
  }

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
              仅显示 NAI 生成记录 · 点击行展开计费与请求参数 · 默认最近 7 天，最多可查 90 天
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                aria-label="开始日期"
                value={range.start}
                max={range.end}
                onChange={(event) => changeDate("start", event.target.value)}
                className="field h-9 px-2.5 text-xs"
              />
              <span className="text-[var(--muted)]">~</span>
              <input
                type="date"
                aria-label="结束日期"
                value={range.end}
                min={range.start}
                onChange={(event) => changeDate("end", event.target.value)}
                className="field h-9 px-2.5 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-pressed={range.start === presetRange(1).start && range.end === presetRange(1).end} onClick={() => applyPreset(1)} className="rounded border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--rose)] hover:text-[var(--rose)]">今天</button>
              <button type="button" aria-pressed={range.start === presetRange(7).start && range.end === presetRange(7).end} onClick={() => applyPreset(7)} className="rounded border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--rose)] hover:text-[var(--rose)]">最近 7 天</button>
              <button type="button" aria-pressed={range.start === presetRange(30).start && range.end === presetRange(30).end} onClick={() => applyPreset(30)} className="rounded border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--rose)] hover:text-[var(--rose)]">最近 30 天</button>
            </div>
            <button
              type="button"
              aria-label="按当前范围刷新"
              title="刷新"
              onClick={() => { setLoading(true); setReloadToken((token) => token + 1); }}
              className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] bg-white text-[var(--muted)] transition-colors hover:border-[var(--rose)] hover:text-[var(--rose)]"
            >
              <RotateCcw size={14} />
            </button>
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
          items.filter(isNaiItem).map((item, index) => {
            // new-api 返回的日志 id 是每页从 1 重排的假序号，会撞车；
            // request_id 才是全局唯一，没有时退到「页索引+序号」。
            const rowId =
              String(item.request_id || "") || `${page}-${index}`;
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
// 后端已按 model_name=nai-% 过滤，此处仅作兜底。
function isNaiItem(item: LogItem): boolean {
  const model = String(item.model_name || item.model || item.name || "");
  return model.toLowerCase().startsWith("nai-");
}

// NewAPI 返回原始 quota，除以 QUOTA_PER_UNIT(500000) 才是美元消耗。
function formatQuota(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "-";
  return `$${(numeric / 500000).toFixed(2)}`;
}

// 展开区：聚合日志行与 other 里的计费参数，分组呈现。
function LogDetail({ item }: { item: LogItem }) {
  const other = parseOther(item.other);
  const generation =
    item.generation && typeof item.generation === "object"
      ? (item.generation as Record<string, unknown>)
      : null;
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
        {generation && <GenerationCard generation={generation} />}
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

// LFN 工作台留档的完整生成参数：NewAPI 日志只有计费信息，
// 由 /api/usage 按「同模型 + 时间相近」从生成历史关联而来。
function GenerationCard({
  generation,
}: {
  generation: Record<string, unknown>;
}) {
  const text = (key: string) =>
    typeof generation[key] === "string" ? (generation[key] as string) : "";
  const num = (key: string) =>
    generation[key] == null ? "-" : String(generation[key]);
  const rows: [string, string][] = [
    ["模式", text("operation") || "-"],
    [
      "尺寸",
      generation.width ? `${num("width")}×${num("height")}` : "-",
    ],
    ["步数", num("steps")],
    ["提示词相关性", num("scale")],
    ["采样器", text("sampler") || "-"],
    ["噪声调度", text("noise_schedule") || "-"],
    ["种子", num("seed")],
  ];
  if (generation.n != null) rows.push(["张数", num("n")]);
  if (generation.strength != null) rows.push(["重绘强度", num("strength")]);
  if (generation.cfg_rescale != null) rows.push(["CFG 重缩放", num("cfg_rescale")]);
  if (generation.sm != null) rows.push(["SMEA", generation.sm ? "启用" : "禁用"]);
  if (generation.sm_dyn != null) rows.push(["SMEA DYN", generation.sm_dyn ? "启用" : "禁用"]);
  if (generation.uncond_scale != null) rows.push(["无条件尺度", num("uncond_scale")]);
  if (generation.ucPreset != null) rows.push(["负向预设", num("ucPreset")]);
  if (generation.qualityToggle != null) rows.push(["品质标签", generation.qualityToggle ? "启用" : "禁用"]);
  if (generation.add_original_image != null) rows.push(["附加原图", generation.add_original_image ? "是" : "否"]);
  if (generation.controlnet_strength != null) rows.push(["ControlNet 强度", num("controlnet_strength")]);
  if (generation.dynamic_thresholding != null) rows.push(["动态阈值", generation.dynamic_thresholding ? "启用" : "禁用"]);
  if (generation.legacy != null) rows.push(["遗留模式", generation.legacy ? "是" : "否"]);
  if (generation.v4_negative != null) rows.push(["V4 负向", generation.v4_negative ? "启用" : "禁用"]);
  if (generation.v4_prompt != null) rows.push(["V4 提示词", generation.v4_prompt ? "启用" : "禁用"]);
  if (generation.params_version != null) rows.push(["参数版本", num("params_version")]);
  if (generation.reference_image_multiple != null) rows.push(["参考图数量", String((generation.reference_image_multiple as unknown[]).length)]);
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 sm:col-span-2 lg:col-span-1">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-[var(--rose)]">
        生成参数 · LFN 工作台记录
      </p>
      {text("prompt") && (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">
          {text("prompt")}
        </p>
      )}
      {text("negative_prompt") && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--muted)]">
          负向：{text("negative_prompt")}
        </p>
      )}
      <dl className="mt-2 space-y-1.5">
        {rows.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <dt className="shrink-0 text-[var(--muted)]">{key}</dt>
            <dd className="min-w-0 truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
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
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
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
      <WorkspaceNav />
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
