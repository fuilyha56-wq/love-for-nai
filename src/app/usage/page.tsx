"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ListFilter, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";
import { DateRangePicker } from "@/app/ui/date-range-picker";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type LogItem = Record<string, unknown>;
type DateRange = { start: string; end: string };
type Filters = DateRange & { model: string; status: string; source: string; requestId: string; startTime: string; endTime: string; sort: "asc" | "desc" };

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

function initialFilters(): Filters {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const fallback = presetRange(7);
  return {
    start: params.get("dateStart") || fallback.start,
    end: params.get("dateEnd") || fallback.end,
    model: params.get("model") || "",
    status: params.get("status") || "",
    source: params.get("source") || "",
    requestId: params.get("requestId") || "",
    startTime: params.get("startTime") || "",
    endTime: params.get("endTime") || "",
    sort: params.get("sort") === "asc" ? "asc" : "desc",
  };
}

export default function UsagePage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [page, setPage] = useState(() => {
    if (typeof window === "undefined") return 1;
    const value = Number(new URLSearchParams(window.location.search).get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  });
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [sourceOptions, setSourceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const range: DateRange = { start: filters.start, end: filters.end };

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        const values = Array.isArray(result.items) ? result.items : [];
        setModelOptions(values.flatMap((item: unknown) => {
          const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
          const value = String(record.id || record.model || "");
          return value.toLowerCase().startsWith("nai-") ? [{ value, label: String(record.name || value) }] : [];
        }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("dateStart", filters.start);
    params.set("dateEnd", filters.end);
    if (filters.model) params.set("model", filters.model);
    if (filters.status) params.set("status", filters.status);
    if (filters.source) params.set("source", filters.source);
    if (filters.requestId) params.set("requestId", filters.requestId);
    if (filters.startTime) params.set("startTime", filters.startTime);
    if (filters.endTime) params.set("endTime", filters.endTime);
    if (filters.sort !== "desc") params.set("sort", filters.sort);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: String(page),
      start: String(dateToStartSeconds(filters.start)),
      end: String(dateToEndSeconds(filters.end)),
      sort: filters.sort,
    });
    if (filters.model) query.set("model", filters.model);
    if (filters.status) query.set("status", filters.status);
    if (filters.source) query.set("source", filters.source);
    if (filters.requestId) query.set("requestId", filters.requestId);
    if (filters.startTime) query.set("startTime", filters.startTime);
    if (filters.endTime) query.set("endTime", filters.endTime);
    fetch(`/api/usage?${query}`, {
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
        const sources = Array.from(new Set((result.items || []).map((item) => usageSource(item)).filter(Boolean)));
        setSourceOptions(sources.map((value) => ({ value, label: sourceLabel(value) })));
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
  }, [page, filters, reloadToken]);

  function updateFilter(patch: Partial<Filters>) {
    setLoading(true);
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }

  function applyPreset(days: number) {
    updateFilter(presetRange(days));
  }

  return (
    <ProductPage title="使用记录" icon={<ListFilter size={20} />}>
      {expired && <SessionExpiredNotice message={expired} />}
      {message && <Notice>{message}</Notice>}
        <div className="usage-filter-card mb-4" aria-label="使用记录筛选">
          <div className="usage-filter-primary">
            <DateRangePicker value={range} onChange={(value) => updateFilter(value)} quickRanges={[{ label: "今天", getValue: () => presetRange(1) }, { label: "最近 7 天", getValue: () => presetRange(7) }, { label: "最近 30 天", getValue: () => presetRange(30) }]} />
            <div className="usage-filter-field usage-filter-model"><span>模型</span><PopupSelect ariaLabel="模型筛选" value={filters.model} options={[{ value: "", label: "全部模型" }, ...modelOptions]} onChange={(value) => updateFilter({ model: value })} searchable searchPlaceholder="搜索模型" /></div>
            <div className="usage-filter-field usage-filter-status"><span>状态</span><PopupSelect ariaLabel="状态筛选" value={filters.status} options={[{ value: "", label: "全部状态" }, { value: "pending", label: "进行中" }, { value: "success", label: "成功" }, { value: "failed", label: "失败" }]} onChange={(value) => updateFilter({ status: value })} /></div>
            {sourceOptions.length > 0 && <div className="usage-filter-field usage-filter-source"><span>来源</span><PopupSelect ariaLabel="来源筛选" value={filters.source} options={[{ value: "", label: "全部来源" }, ...sourceOptions]} onChange={(value) => updateFilter({ source: value })} /></div>}
            <PopupSelect ariaLabel="结果排序" value={filters.sort} options={[{ value: "desc", label: "最新优先" }, { value: "asc", label: "最早优先" }]} onChange={(value) => updateFilter({ sort: value as Filters["sort"] })} />
            <button type="button" className="usage-filter-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? "收起" : "更多筛选"}<ChevronDown size={14} className={advancedOpen ? "rotate-180" : ""} /></button>
          </div>
          {advancedOpen && <div className="usage-filter-advanced"><input className="field usage-request-input" aria-label="请求 ID" placeholder="请求 ID" value={filters.requestId} onChange={(event) => updateFilter({ requestId: event.target.value })} /><input className="field usage-time-input" aria-label="开始时间" type="time" value={filters.startTime} onChange={(event) => updateFilter({ startTime: event.target.value })} /><span className="usage-filter-separator">~</span><input className="field usage-time-input" aria-label="结束时间" type="time" value={filters.endTime} onChange={(event) => updateFilter({ endTime: event.target.value })} /><div className="usage-filter-chips"><button type="button" aria-pressed={range.start === presetRange(1).start && range.end === presetRange(1).end} onClick={() => applyPreset(1)}>今天</button><button type="button" aria-pressed={range.start === presetRange(7).start && range.end === presetRange(7).end} onClick={() => applyPreset(7)}>最近 7 天</button><button type="button" aria-pressed={range.start === presetRange(30).start && range.end === presetRange(30).end} onClick={() => applyPreset(30)}>最近 30 天</button></div><button type="button" aria-label="按当前范围刷新" title="刷新" className="usage-refresh-button" onClick={() => { setLoading(true); setReloadToken((token) => token + 1); }}><RotateCcw size={14} /></button></div>}
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
          items.filter((item) => isNaiItem(item) && (!filters.source || usageSource(item) === filters.source)).map((item, index) => {
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

function usageSource(item: LogItem): string {
  const other = parseOther(item.other);
  const raw = String(
    item.provider || item.provider_id || item.providerId || other?.providerId || other?.billing_source || other?.request_path || "newapi",
  ).toLowerCase();
  if (raw.includes("lfn")) return "lfn";
  if (raw.includes("api") || raw.includes("newapi")) return "newapi";
  if (raw.includes("novelai") || raw.includes("nai")) return "novelai";
  return raw || "other";
}

function sourceLabel(value: string): string {
  if (value === "lfn") return "LFN API";
  if (value === "newapi") return "NewAPI";
  if (value === "novelai") return "NovelAI";
  return value;
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
  const labels: Record<string, string> = {
    operation: "模式 / Operation", width: "宽度 / Width", height: "高度 / Height", steps: "步数 / Steps", scale: "引导强度 / Scale",
    sampler: "采样器 / Sampler", noise_schedule: "噪声调度 / Noise schedule", seed: "种子 / Seed", n: "生成数量 / Samples", n_samples: "NAI 生成数量 / NAI samples",
    cfg_rescale: "CFG 重缩放 / CFG rescale", strength: "重绘强度 / Strength", noise: "噪声 / Noise", params_version: "参数版本 / Params version",
    ucPreset: "负向预设 / UC preset", qualityToggle: "品质标签 / Quality tags", add_original_image: "附加原图 / Add original image", autoSmea: "自动 SMEA / Auto SMEA",
    deliberate_euler_ancestral_bug: "Euler ancestral 兼容 / Compatibility", prefer_brownian: "Brownian 噪声 / Brownian noise", sm: "SMEA / SMEA", sm_dyn: "动态 SMEA / SMEA dynamic",
    uncond_scale: "无条件尺度 / Uncond scale", v4_negative: "V4 负向 / V4 negative", v4_prompt: "V4 提示词 / V4 prompt", dynamic_thresholding: "动态阈值 / Dynamic thresholding",
    controlnet_strength: "ControlNet 强度 / ControlNet strength", legacy: "遗留模式 / Legacy", emotion: "表情 / Emotion", defry: "去伪影 / Defry",
    use_coords: "使用坐标 / Use coordinates", reference_strength: "参考图强度 / Reference strength", reference_information_extracted: "参考信息提取 / Reference information extracted",
    quality: "质量 / Quality", imageSize: "图像尺寸 / Image size", background: "背景 / Background", providerId: "服务商 / Provider", imageProtocol: "图像协议 / Image protocol",
  };
  const preferredKeys = ["operation", "width", "height", "steps", "scale", "sampler", "noise_schedule", "seed", "n", "n_samples", "cfg_rescale", "strength", "noise", "params_version", "ucPreset", "qualityToggle", "add_original_image", "autoSmea", "deliberate_euler_ancestral_bug", "prefer_brownian", "sm", "sm_dyn", "uncond_scale", "v4_negative", "v4_prompt", "dynamic_thresholding", "controlnet_strength", "legacy", "emotion", "defry", "use_coords", "reference_strength", "reference_information_extracted", "quality", "imageSize", "background", "providerId", "imageProtocol"];
  const rows: [string, string][] = preferredKeys.filter((key) => generation[key] != null).map((key) => {
    const value = generation[key];
    const display = typeof value === "boolean" ? (value ? "启用 / Enabled" : "禁用 / Disabled") : typeof value === "object" ? JSON.stringify(value) : String(value);
    return [labels[key] || `${key} / ${key}`, display];
  });
  const displayedKeys = new Set(preferredKeys);
  for (const [key, value] of Object.entries(generation)) {
    if (displayedKeys.has(key) || value == null || ["prompt", "negative_prompt"].includes(key)) continue;
    rows.push([`${key} / ${key}`, typeof value === "object" ? JSON.stringify(value) : String(value)]);
  }
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3 sm:col-span-2 lg:col-span-1">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-[var(--rose)]">
        生成参数 / Generation parameters · LFN 工作台记录 / Studio record
      </p>
      {text("prompt") && (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5" title="提示词 / Prompt">
          <span className="font-semibold text-[var(--muted)]">提示词 / Prompt： </span>
          {text("prompt")}
        </p>
      )}
      {text("negative_prompt") && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--muted)]" title="反向提示词 / Negative prompt">
          反向提示词 / Negative prompt：{text("negative_prompt")}
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
