import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";
import { listHistory } from "@/lib/history";

type LogEntry = Record<string, unknown>;
type UpstreamPage = { items: LogEntry[]; total: number };

const PAGE_SIZE = 20;
// 每个模型预取的条数：归并排序后可保证前 10 页精确。
const PER_MODEL_LIMIT = 200;

async function fetchModelPage(
  model: string,
  page: number,
  headers: Record<string, string>,
): Promise<UpstreamPage> {
  const params = new URLSearchParams({
    p: String(page),
    page: String(page),
    size: String(PER_MODEL_LIMIT),
    page_size: String(PER_MODEL_LIMIT),
    type: "2",
    model_name: model,
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
  try {
    let pages: UpstreamPage[];
    let total: number;
    const models = await fetchNaiModelNames(headers);
    if (models?.length) {
      const settled = await Promise.allSettled(
        models.map((model) => fetchModelPage(model, 1, headers)),
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
        model_name: "nai-%",
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
    // 上游返回的 id 是分页内假序号，时间序必须按 created_at 排。
    const merged = pages
      .flatMap((item) => item.items)
      .sort(
        (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0),
      );
    const start = (page - 1) * PAGE_SIZE;
    const visible = merged.slice(start, start + PAGE_SIZE);
    return NextResponse.json({
      items: await attachGenerationParams(session.userId, visible),
      total,
      page,
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
