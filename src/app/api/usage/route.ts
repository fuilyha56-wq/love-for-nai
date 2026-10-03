import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";
import { listHistory } from "@/lib/history";

type LogEntry = Record<string, unknown>;
type UpstreamPage = { items: LogEntry[]; total: number };

const PAGE_SIZE = 20;
// 每个模型预取的条数：归并排序后可保证前 10 页精确。
const PER_MODEL_LIMIT = 200;
// 日期范围限制：默认最近 7 天，最多可查 90 天，避免全表扫描拖垮 NewAPI。
const DEFAULT_RANGE_SECONDS = 7 * 24 * 3600;
const MAX_RANGE_SECONDS = 90 * 24 * 3600;

type UsageFilters = {
  model: string;
  status: string;
  requestId: string;
  sort: "asc" | "desc";
  range: { start: number; end: number };
};

function parseClock(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  return hour <= 23 && minute <= 59 && second <= 59 ? hour * 3600 + minute * 60 + second : null;
}

/** 解析并钳位日期/时间范围（本地时区转 unix 秒），兼容旧 start/end 秒参数。 */
function resolveRange(request: NextRequest): { start: number; end: number } {
  const params = request.nextUrl.searchParams;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const requestedEnd = Number(params.get("end"));
  const requestedStart = Number(params.get("start"));
  let end = Number.isFinite(requestedEnd) && requestedEnd > 0
    ? Math.min(requestedEnd, nowSeconds + 60)
    : nowSeconds;
  let start = Number.isFinite(requestedStart) && requestedStart > 0
    ? requestedStart
    : end - DEFAULT_RANGE_SECONDS;
  const dateSeconds = (value: string | null, fallback: number): number => {
    if (!value) return fallback;
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000) : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return fallback;
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  };
  const startClock = parseClock(params.get("startTime"));
  const endClock = parseClock(params.get("endTime"));
  if (startClock != null) {
    const base = dateSeconds(params.get("dateStart") || params.get("start"), start);
    start = base + startClock;
  }
  if (endClock != null) {
    const base = dateSeconds(params.get("dateEnd") || params.get("end"), end);
    end = Math.min(base + endClock, nowSeconds + 60);
  }
  if (end - start > MAX_RANGE_SECONDS) start = end - MAX_RANGE_SECONDS;
  if (start > end) start = end;
  return { start, end };
}

function resolveFilters(request: NextRequest): UsageFilters {
  const params = request.nextUrl.searchParams;
  const rawSort = params.get("sort")?.toLowerCase();
  return {
    model: (params.get("model") || "").trim().slice(0, 160),
    status: (params.get("status") || "").trim().toLowerCase().slice(0, 40),
    requestId: (params.get("requestId") || "").trim().slice(0, 160),
    sort: rawSort === "asc" || rawSort === "oldest" ? "asc" : "desc",
    range: resolveRange(request),
  };
}

function statusMatches(item: LogEntry, requested: string): boolean {
  if (!requested || requested === "all") return true;
  const value = String(item.status || item.type_name || "").toLowerCase();
  if (requested === "success") return ["success", "succeeded", "completed", "完成", "成功", "2"].some((token) => value.includes(token));
  if (requested === "failed") return ["fail", "error", "失败", "错误", "4", "5"].some((token) => value.includes(token));
  if (requested === "pending" || requested === "running") return ["pending", "process", "running", "进行", "排队", "处理中", "1"].some((token) => value.includes(token));
  return value === requested;
}

function itemModel(item: LogEntry): string {
  return String(item.model_name || item.model || item.name || "");
}

function itemRequestId(item: LogEntry): string {
  return String(item.request_id || item.requestId || "");
}

function itemTime(item: LogEntry): number {
  const value = item.created_at ?? item.createdAt ?? item.timestamp;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric : numeric / 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function filterItems(items: LogEntry[], filters: UsageFilters): LogEntry[] {
  return items.filter((item) =>
    (!filters.model || itemModel(item) === filters.model) &&
    (!filters.requestId || itemRequestId(item).toLowerCase().includes(filters.requestId.toLowerCase())) &&
    statusMatches(item, filters.status),
  );
}

async function fetchModelPage(
  model: string,
  page: number,
  headers: Record<string, string>,
  range: { start: number; end: number },
): Promise<UpstreamPage> {
  const params = new URLSearchParams({
    p: String(page),
    page: String(page),
    size: String(PER_MODEL_LIMIT),
    page_size: String(PER_MODEL_LIMIT),
    type: "2",
    model_name: model,
    start_timestamp: String(range.start),
    end_timestamp: String(range.end),
  });
  const response = await fetch(
    `${newApiBaseUrl()}/api/log/self?${params}`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(result.message || "无法读取使用记录");
  const source = result.data || {};
  const items = Array.isArray(source)
    ? source
    : source.items || source.data || [];
  return { items, total: Number(source.total || source.total_count || 0) };
}

// 该版本 NewAPI 的 model_name 通配会全表扫描（约 9s），改为先发现
// 用户组内的 nai-* 模型，再并行精确查询（索引命中，约 1s）。
async function fetchNaiModelNames(headers: Record<string, string>) {
  try {
    const response = await fetch(
      `${newApiBaseUrl()}/api/user/models`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    const result = await response.json();
    const models: unknown[] = Array.isArray(result.data) ? result.data : [];
    return models
      .filter(
        (model): model is string =>
          typeof model === "string" && model.toLowerCase().startsWith("nai-"),
      )
      .slice(0, 24);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看使用记录", sessionExpired: true },
      { status: 401 },
    );
  const requested = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), 1000)
    : 1;
  const headers = userHeaders(session);
  const filters = resolveFilters(request);
  const allowedStatuses = new Set(["", "all", "pending", "running", "success", "failed"]);
  if (!allowedStatuses.has(filters.status))
    return NextResponse.json({ message: "状态筛选参数无效" }, { status: 400 });
  if ((request.nextUrl.searchParams.get("startTime") && parseClock(request.nextUrl.searchParams.get("startTime")) == null) ||
      (request.nextUrl.searchParams.get("endTime") && parseClock(request.nextUrl.searchParams.get("endTime")) == null))
    return NextResponse.json({ message: "时间筛选参数无效，请使用 HH:mm 或 HH:mm:ss" }, { status: 400 });
  const range = filters.range;
  try {
    let pages: UpstreamPage[];
    let total: number;
    const discoveredModels = await fetchNaiModelNames(headers);
    const models = filters.model
      ? [filters.model]
      : discoveredModels;
    if (models?.length) {
      const settled = await Promise.allSettled(
        models.map((model) => fetchModelPage(model, 1, headers, range)),
      );
      const fulfilled = settled.flatMap((item) =>
        item.status === "fulfilled" ? [item.value] : [],
      );
      // 全部失败时向上抛（常见为登录过期），部分失败按已有数据展示。
      if (!fulfilled.length) {
        const first = settled.find(
          (item): item is PromiseRejectedResult => item.status === "rejected",
        );
        throw first?.reason instanceof Error
          ? first.reason
          : new Error("无法读取使用记录");
      }
      pages = fulfilled;
      total = pages.reduce((sum, item) => sum + item.total, 0);
    } else {
      // 兜底：通配一次（较慢，仅在模型发现不可用时）。
      const params = new URLSearchParams({
        p: String(page),
        page: String(page),
        size: String(PAGE_SIZE),
        page_size: String(PAGE_SIZE),
        type: "2",
        model_name: filters.model || "nai-%",
        start_timestamp: String(range.start),
        end_timestamp: String(range.end),
      });
      const response = await fetch(
        `${newApiBaseUrl()}/api/log/self?${params}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(25_000) },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.message || "无法读取使用记录");
      const source = result.data || {};
      const items = Array.isArray(source)
        ? source
        : source.items || source.data || [];
      pages = [
        {
          items,
          total: Number(source.total || source.total_count || 0),
        },
      ];
      total = pages[0].total;
    }
    // 上游返回的 id 是分页内假序号；筛选后重新计数，时间序按用户选择排序。
    const filtered = filterItems(pages.flatMap((item) => item.items), filters);
    const merged = filtered.sort((a, b) => {
      const delta = itemTime(a) - itemTime(b);
      return filters.sort === "asc" ? delta : -delta;
    });
    const start = (page - 1) * PAGE_SIZE;
    const visible = merged.slice(start, start + PAGE_SIZE);
    return NextResponse.json({
      items: await attachGenerationParams(session.userId, visible),
      total: filters.model || filters.status || filters.requestId ? merged.length : total,
      page,
      range,
      filters: { model: filters.model, status: filters.status, requestId: filters.requestId, sort: filters.sort },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取使用记录";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}

// NewAPI 日志只有计费信息；用 LFN 自己的生成历史按「同模型 + 时间相近」
// 关联出真实请求参数，供前端点击展开查看。
async function attachGenerationParams(userId: number, items: LogEntry[]) {
  if (!Array.isArray(items) || !items.length) return items;
  const history = await listHistory(userId).catch(() => []);
  if (!history.length) return items;
  const available = history.filter((item) => item.parameters?.model);
  if (!available.length) return items;
  const used = new Set<string>();
  return items.map((item) => {
    const logTime = Number(item.created_at) * 1000;
    const model = String(item.model_name || "");
    if (!Number.isFinite(logTime) || !model) return item;
    let match: (typeof available)[number] | null = null;
    let bestDelta = 30_000;
    for (const entry of available) {
      if (used.has(entry.id) || entry.parameters.model !== model) continue;
      const delta = Math.abs(Date.parse(entry.createdAt) - logTime);
      if (delta <= bestDelta) {
        bestDelta = delta;
        match = entry;
      }
    }
    if (!match) return item;
    used.add(match.id);
    return { ...item, generation: match.parameters };
  });
}
