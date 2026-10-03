import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type DocumentStatus = "draft" | "published";

export type Document = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  status: DocumentStatus;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** Seeded documents are kept as stable built-in content and cannot be deleted. */
  builtIn?: boolean;
};

type Store = { items: Document[]; removedIds?: string[] };

const root = () =>
  path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "documents");
const storePath = () => path.join(root(), "index.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<Store> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as Partial<Store>;
    const items = Array.isArray(value.items) ? value.items.filter(isDocument) : [];
    return {
      items,
      removedIds: Array.isArray(value.removedIds)
        ? value.removedIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { items: [] };
  }
}

function isDocument(value: unknown): value is Document {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Document>;
  return (
    typeof item.id === "string" &&
    typeof item.slug === "string" &&
    typeof item.title === "string" &&
    typeof item.category === "string" &&
    typeof item.summary === "string" &&
    typeof item.content === "string" &&
    (item.status === "draft" || item.status === "published") &&
    typeof item.sortOrder === "number" &&
    typeof item.version === "number" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.updatedBy === "string"
  );
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

const SEEDED_DOCUMENTS: Document[] = [
  {
    id: "docs-api-overview", slug: "api-overview", title: "API 接入总览", category: "API 接入",
    summary: "了解 LFN 的 NovelAI 原生、OpenAI 兼容和站内 API 三种接入格式。",
    content: [
      "# API 接入总览", "", "Love for NAI（LFN）对外提供三种接入格式：NovelAI 原生 /ai、OpenAI 兼容 /v1，以及本站页面使用的 /api。", "",
      "## 选择合适的入口", "", "- **/ai**：请求和响应接近 NovelAI 官方格式，适合 NAI 客户端与脚本。", "- **/v1**：标准 OpenAI 图像接口形状，适合已经支持 OpenAI 的工具。", "- **/api**：本站前端使用的内部接口，需要登录会话，不承诺外部兼容。", "",
      "外部调用需要在 API 密钥页创建 LFN API 密钥，并使用 `Authorization: Bearer <LFN_API_KEY>` 鉴权。", "", "发布后的文档会即时出现在公开文档页，无需重新构建站点。",
    ].join("\n"),
    status: "published", sortOrder: 10, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-auth-billing", slug: "authentication-and-billing", title: "鉴权与计费", category: "API 接入",
    summary: "API 密钥格式、模型名称和扣费顺序说明。",
    content: [
      "# 鉴权与计费", "", "## 鉴权", "", "调用 `/ai` 和 `/v1` 时，请在请求头加入：", "", "`Authorization: Bearer <LFN_API_KEY>`", "",
      "LFN API 密钥只用于识别和结算请求，浏览器不会暴露上游密钥。密钥可以在[API 密钥](/keys)页面创建、停用或删除。", "", "## 计费顺序", "", "1. 优先使用图包额度。", "2. 个人 AFF 额度用于补足。", "3. 两者都不足时，按站点配置使用托管上游渠道。", "", "参数会在扣费前校验；非法请求不会扣费。请求实际生成张数少于请求张数时，按实际结果结算。",
    ].join("\n"),
    status: "published", sortOrder: 20, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-models-limits", slug: "models-and-limits", title: "模型与请求限制", category: "参考",
    summary: "模型名对照、尺寸、步数、参考图和限速规则。",
    content: [
      "# 模型与请求限制", "", "同一模型在 `/ai` 使用 NovelAI 官方名称（例如 `nai-diffusion-5-full`），在 `/v1` 使用别名（例如 `nai-v5-full`）。完整目录以 `GET /v1/models` 返回为准。", "",
      "## 常用模型", "", "| 官方名（/ai） | 别名（/v1） | 版本 |", "| --- | --- | --- |", "| nai-diffusion-5-full | nai-v5-full | V5 |", "| nai-diffusion-5-curated | nai-v5-curated | V5 |", "| nai-diffusion-4-5-full | nai-v4.5-full | V4.5 |", "| nai-diffusion-4-5-curated | nai-v4.5-curated | V4.5 |", "", "## 硬限制", "", "- 尺寸单边 64–1600，且必须是 8 的倍数。", "- `n` / `n_samples` 为 1–30，步数为 1–50。", "- Vibe 与精确参考合计最多 12 张。", "- 请求体上限 25 MiB。", "- 每个 API 密钥每分钟最多 30 次图像请求。",
    ].join("\n"),
    status: "published", sortOrder: 30, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-quickstart", slug: "quickstart", title: "快速开始", category: "入门", summary: "用 curl 完成第一张图像生成请求。",
    content: [
      "# 快速开始", "", "先在站点的 API 密钥页面创建密钥，然后运行下面的文生图请求：", "", "```bash", "curl -X POST '<站点地址>/v1/images/generations' \\", "  -H 'Authorization: Bearer <LFN_API_KEY>' \\", "  -H 'Content-Type: application/json'", "  -d '{\"model\":\"nai-v4.5-full\",\"prompt\":\"1girl, masterpiece\",\"size\":\"832x1216\",\"response_format\":\"b64_json\"}'", "```", "", "成功响应包含 `data[].b64_json`。也可以直接使用站内工作台，生成结果会自动进入历史记录。", "", "遇到问题时，先确认密钥状态，再调用 `GET /v1/models` 检查模型目录，最后检查图片尺寸与张数限制。",
    ].join("\n"),
    status: "published", sortOrder: 40, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-native-reference", slug: "native-api-reference", title: "NAI 原生接口参考", category: "API 参考", summary: "生成、流式、超分、Vibe 和 Director 的请求结构与返回格式。",
    content: [
      "# NAI 原生接口参考", "", "所有接口都使用 `Authorization: Bearer <LFN_API_KEY>`，请求地址为站点地址加端点。图片类接口默认返回 ZIP，解压后得到 PNG。", "",
      "## 文生图", "", "```bash", "curl -X POST '<站点地址>/ai/generate-image' \\", "  -H 'Authorization: Bearer <LFN_API_KEY>' \\", "  -H 'Content-Type: application/json' \\", "  -d '{\"input\":\"1girl, masterpiece\",\"model\":\"nai-diffusion-5-full\",\"action\":\"generate\",\"parameters\":{\"width\":832,\"height\":1216,\"steps\":28,\"scale\":5,\"sampler\":\"k_euler_ancestral\",\"noise_schedule\":\"karras\",\"n_samples\":1}}'", "```", "", "`action` 支持 `generate`、`img2img`、`infill`。图生图需要在 parameters 中提供 `image`；局部重绘还需要同尺寸的 `mask`，白色区域表示重绘。", "",
      "## 流式与工具", "", "- `/ai/generate-image-stream`：同一请求结构，返回 `x-msgpack` 增量块。", "- `/ai/upscale`：V5 双模型固定 2x，输入 base64 PNG，`declared_blur_sigma` 固定为 0。", "- `/ai/encode-vibe`：提交 `image` 或 `images`，返回 Vibe 编码。", "- `/ai/augment-image`：Director 工具，`req_type` 支持 `declutter`、`bg-removal`、`lineart`、`sketch`、`colorize`、`emotion`。", "- `/ai/annotate-image`：图像标注，默认模型为 `hed`。", "", "## 常见错误", "", "`400` 表示参数或模型能力不合法；`401` 表示密钥无效；`413` 表示超过 25 MiB；`429` 表示触发限速。模型和能力以 `GET /v1/models` 返回为准。",
    ].join("\n"),
    status: "published", sortOrder: 50, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-openai-reference", slug: "openai-compatible-api", title: "OpenAI 兼容接口参考", category: "API 参考", summary: "使用标准 Images API 接入 LFN，包含生成、编辑、模型列表和响应示例。",
    content: [
      "# OpenAI 兼容接口参考", "", "所有请求都需要 `Authorization: Bearer <LFN_API_KEY>`。目前图像接口覆盖 Images API 的常见生成和编辑场景。", "",
      "## 文生图", "", "```bash", "curl -X POST '<站点地址>/v1/images/generations' \\", "  -H 'Authorization: Bearer <LFN_API_KEY>' \\", "  -H 'Content-Type: application/json' \\", "  -d '{\"model\":\"nai-v5-full\",\"prompt\":\"1girl, masterpiece\",\"size\":\"832x1216\",\"n\":1,\"response_format\":\"b64_json\"}'", "```", "", "成功响应为 JSON，图片内容位于 `data[].b64_json`。`size` 使用 `宽x高` 格式；可选模型以 `/v1/models` 返回为准。", "",
      "## 图像编辑与局部重绘", "", "`POST /v1/images/edits` 支持 JSON（data URL）和 multipart/form-data。只提供 `image` 时执行图生图；同时提供 `mask` 时执行局部重绘。multipart 请求中 `image`、`mask` 是二进制文件，其余字段作为表单字段传入。", "", "```json", "{", "  \"model\": \"nai-v4.5-inpaint\",", "  \"prompt\": \"repair the masked area\",", "  \"image\": \"data:image/png;base64,<BASE64_PNG>\",", "  \"mask\": \"data:image/png;base64,<BASE64_MASK>\",", "  \"size\": \"832x1216\",", "  \"response_format\": \"b64_json\"", "}", "```", "", "## 模型列表", "", "调用 `GET /v1/models` 获取当前密钥可用模型；`GET /v1/model` 为兼容别名。模型是否可用由账号分组和站点模型策略共同决定。",
    ].join("\n"),
    status: "published", sortOrder: 60, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
  {
    id: "docs-troubleshooting", slug: "troubleshooting", title: "请求排查指南", category: "故障排查", summary: "根据 HTTP 状态码、请求 ID、模型和时间范围定位常见问题。",
    content: [
      "# 请求排查指南", "", "## 先收集定位信息", "", "记录发生时间（含时区）、请求 ID、模型名、端点和 HTTP 状态码。不要在工单或截图中公开 API 密钥、Cookie 或完整 Authorization 请求头。", "", "## 常见状态码", "", "| 状态码 | 常见原因 | 建议检查 |", "| --- | --- | --- |", "| 400 | 参数、尺寸、mask 或模型能力不符合要求 | 检查模型目录、尺寸是否为 8 的倍数、operation 所需字段 |", "| 401 | API 密钥无效、停用或缺失 | 在密钥管理页确认状态，并检查 Bearer 格式 |", "| 404 | 路径或模型不存在 | 核对端点拼写，并查询 `/v1/models` |", "| 413 | 请求体超过大小上限 | 压缩或缩小输入图像，移除不需要的参考图 |", "| 429 | 请求限速或额度/上游并发限制 | 等待 `Retry-After` 后重试，避免无间隔重放 |", "| 502/503 | 上游暂时不可用或超时 | 保存请求 ID 和时间，稍后重试并检查公告 |", "", "## 生成日志", "", "登录后打开[使用记录](/usage)，按模型、状态、请求 ID、开始/结束日期和时间筛选。展开记录可查看计费、渠道、分组和关联生成参数。日志保留时间受上游和站点配置影响。", "", "## 重试建议", "", "遇到超时不要无条件重复提交批量请求。先用单张、小尺寸请求确认服务恢复；对客户端重试设置退避和次数上限，并为业务侧请求保留自己的幂等标识。",
    ].join("\n"),
    status: "published", sortOrder: 70, version: 1, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", updatedBy: "LFN", builtIn: true,
  },
];

export class DocumentVersionConflictError extends Error {
  constructor(public readonly document: Document) {
    super("文档版本已更新，请刷新后重试");
    this.name = "DocumentVersionConflictError";
  }
}

export class BuiltInDocumentError extends Error {
  constructor() {
    super("内置文档不能删除");
    this.name = "BuiltInDocumentError";
  }
}

export async function ensureSeed(): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const removed = new Set(store.removedIds || []);
    let changed = false;
    for (const seed of SEEDED_DOCUMENTS) {
      if (removed.has(seed.id) || store.items.some((item) => item.id === seed.id)) continue;
      store.items.push(seed);
      changed = true;
    }
    if (changed) await writeStore(store);
  });
}

function sortDocuments(items: Document[]): Document[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt));
}

export async function listDocuments(options: { publishedOnly?: boolean } = {}): Promise<Document[]> {
  await ensureSeed();
  const store = await readStore();
  return sortDocuments(options.publishedOnly ? store.items.filter((item) => item.status === "published") : store.items);
}

export async function getDocumentBySlug(slug: string, options: { publishedOnly?: boolean } = {}): Promise<Document | null> {
  await ensureSeed();
  const store = await readStore();
  const item = store.items.find((candidate) => candidate.slug === slug);
  if (!item || (options.publishedOnly && item.status !== "published")) return null;
  return item;
}

export async function getDocument(id: string): Promise<Document | null> {
  await ensureSeed();
  const store = await readStore();
  return store.items.find((item) => item.id === id) ?? null;
}

export type CreateDocumentInput = Omit<Document, "id" | "createdAt" | "updatedAt" | "version" | "builtIn"> & { builtIn?: boolean };
export type UpdateDocumentInput = Partial<Pick<Document, "slug" | "title" | "category" | "summary" | "content" | "sortOrder" | "status">>;

function assertSlug(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("slug 只能包含小写字母、数字和连字符");
  return value;
}

function assertDocumentFields(input: { slug?: string; title?: string; content?: string }) {
  if (input.slug !== undefined) assertSlug(input.slug);
  if (input.title !== undefined && !input.title.trim()) throw new Error("文档标题不能为空");
  if (input.content !== undefined && !input.content.trim()) throw new Error("文档内容不能为空");
}

export async function createDocument(input: CreateDocumentInput): Promise<Document> {
  return withLock(async () => {
    assertDocumentFields(input);
    const slug = assertSlug(input.slug);
    const store = await readStore();
    if (store.items.some((item) => item.slug === slug)) throw new Error("slug 已存在");
    const now = new Date().toISOString();
    const item: Document = {
      ...input,
      slug,
      title: input.title.trim(),
      summary: input.summary.trim(),
      content: input.content,
      id: randomUUID(),
      status: input.status || "draft",
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: input.updatedBy.trim() || "admin",
      builtIn: false,
    };
    store.items.push(item);
    await writeStore(store);
    return item;
  });
}

export async function updateDocument(id: string, patch: UpdateDocumentInput, expectedVersion?: number, updatedBy = "admin"): Promise<Document | null> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = store.items[index];
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new DocumentVersionConflictError(current);
    assertDocumentFields(patch);
    const nextSlug = patch.slug === undefined ? current.slug : assertSlug(patch.slug);
    if (nextSlug !== current.slug && store.items.some((item, itemIndex) => itemIndex !== index && item.slug === nextSlug)) throw new Error("slug 已存在");
    const next: Document = {
      ...current,
      ...patch,
      slug: nextSlug,
      title: patch.title === undefined ? current.title : patch.title.trim(),
      category: patch.category === undefined ? current.category : patch.category.trim(),
      summary: patch.summary === undefined ? current.summary : patch.summary.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy.trim() || "admin",
      version: current.version + 1,
    };
    store.items[index] = next;
    await writeStore(store);
    return next;
  });
}

export async function publishDocument(id: string, expectedVersion?: number, updatedBy = "admin"): Promise<Document | null> {
  return updateDocument(id, { status: "published" }, expectedVersion, updatedBy);
}

export async function deleteDocument(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    if (store.items[index].builtIn) throw new BuiltInDocumentError();
    store.items.splice(index, 1);
    store.removedIds = Array.from(new Set([...(store.removedIds || []), id]));
    await writeStore(store);
    return true;
  });
}

export function publicDocument(item: Document) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    category: item.category,
    summary: item.summary,
    content: item.content,
    status: item.status,
    sortOrder: item.sortOrder,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  };
}
