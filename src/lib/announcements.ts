import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Announcement = {
  id: string;
  title: string;
  content: string; // Markdown
  level: "info" | "warning";
  createdAt: string;
  updatedAt: string;
  author: string;
  pinned: boolean;
};

type Store = { items: Announcement[]; removedIds?: string[] };
const root = () =>
  path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "announcements");
const storePath = () => path.join(root(), "index.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<Store> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as Store;
    return {
      items: Array.isArray(value.items) ? value.items : [],
      removedIds: Array.isArray(value.removedIds)
        ? value.removedIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { items: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

// 首次部署时的使用教程公告；后续由管理员在管理界面维护。
export const TUTORIAL_ANNOUNCEMENT: Announcement = {
  id: "tutorial-welcome",
  title: "欢迎使用 Love for NAI · 生图与外接 API 教程",
  content: `## 这是什么？

Love for NAI（LFN）是使用现有 NewAPI 账号、余额和模型权限的中文 NovelAI 图像工作台。所有调用经 LFN 服务端代理到 NewAPI 计费，浏览器不会暴露密钥。

## 快速生图

1. 使用 NewAPI 账号登录（账号密码 / 访问令牌均可）。
2. 左侧选择模型、填写描述画面与排除内容。
3. 点击「执行生成」，图片出现在画布，可放大、下载、投稿到图片广场。

## 模型怎么选？

| 模型 | 特点 | 适合 |
| --- | --- | --- |
| V5 完整版（nai-v5-full） | 最新旗舰，画面精致度与语义理解最强，消耗最高 | 追求成品质量的最终出图 |
| V5 精选版（nai-v5-curated） | V5 的轻量版，速度快、消耗低，质量略降 | 快速试错、日常批量 |
| V4.5 完整版（nai-v4.5-full） | 上一代旗舰，风格掌控稳定、社区教程最多 | 复刻成熟参数、插画风格 |
| V4.5 精选版（nai-v4.5-curated） | V4.5 轻量版，最省额度 | 草稿、构图验证 |
| V4 系列（nai-v4-*） | 更早一代，偶尔适合怀旧风格 | 特殊风格补完 |
| V3 系列（nai-v3 / furry） | 老模型，动画感强；furry 版适合兽人题材 | 兽人创作、老参数复现 |

**简评**：新用户从 V5 精选版或 V4.5 完整版起步最稳；额度紧张用 curated 系列试构图，定稿再切 full 系列精修。

## 外接 API 调用（三选一，均用你自己的 NewAPI Key：\`Authorization: Bearer sk-...\`）

### 1. NovelAI 原生格式（推荐给 NAI 客户端/脚本）

\`\`\`bash
curl -X POST http://你的LFN地址/ai/generate-image \\
  -H "Authorization: Bearer sk-你的NewAPI密钥" \\
  -H "Content-Type: application/json" \\
  -d '{"input":"1girl","model":"nai-diffusion-4-5-full","action":"generate","parameters":{"width":832,"height":1216,"steps":28,"scale":5,"sampler":"k_euler_ancestral","noise_schedule":"native"}}' \\
  --output images.zip
\`\`\`

- 请求体就是 NovelAI 官方 JSON（\`input\` / \`model\` / \`action\` / \`parameters\`），模型名兼容 NAI 原名（如 \`nai-diffusion-4-5-full\` 自动映射 \`nai-v4.5-full\`）。
- \`action\`：\`generate\` 文生图 / \`img2img\` 图生图 / \`infill\` 局部重绘。
- 成功返回 \`application/zip\`（内含 PNG）。

### 2. OpenAI 兼容格式

\`\`\`bash
curl -X POST http://你的LFN地址/v1/images/generations \\
  -H "Authorization: Bearer sk-你的NewAPI密钥" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"nai-v4.5-full","prompt":"1girl","size":"832x1216","response_format":"b64_json"}'
\`\`\`

\`GET /v1/models\` 可列出当前 Key 可用的模型。

### 3. 直接调 NewAPI

\`\`\`bash
curl -X POST http://你的NewAPI地址/v1/images/generations \\
  -H "Authorization: Bearer sk-你的NewAPI密钥" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"nai-v4.5-full","prompt":"1girl","size":"832x1216","response_format":"b64_json"}'
\`\`\`

三种方式计费都走 NewAPI 余额；LFN 两种入口只是协议转换，不加价。

## 图片广场

生成后可投稿到图片广场（支持从历史导入或上传带 NAI 参数的本地图片），无需登录即可浏览与分享；R18 作品默认打码。

—— 祝创作愉快！`,
  level: "info",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  author: "LFN",
  pinned: true,
};

export const COMMUNITY_FEEDBACK_ANNOUNCEMENT: Announcement = {
  id: "community-feedback",
  title: "社区反馈征集",
  content: `欢迎在本公告下方评论区反馈 UI 优化、功能需求、颜色/主题、自定义背景、液态玻璃等建议。

液态玻璃默认关闭，视觉偏好尽量在本地计算，不上传用户背景图片。`,
  level: "info",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  author: "LFN",
  pinned: false,
};

export async function ensureSeed(): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    let changed = false;
    const removed = new Set(store.removedIds || []);
    if (
      !removed.has(TUTORIAL_ANNOUNCEMENT.id) &&
      !store.items.some((item) => item.id === TUTORIAL_ANNOUNCEMENT.id)
    ) {
      store.items.push(TUTORIAL_ANNOUNCEMENT);
      changed = true;
    }
    if (
      !removed.has(COMMUNITY_FEEDBACK_ANNOUNCEMENT.id) &&
      !store.items.some((item) => item.id === COMMUNITY_FEEDBACK_ANNOUNCEMENT.id)
    ) {
      store.items.push(COMMUNITY_FEEDBACK_ANNOUNCEMENT);
      changed = true;
    }
    if (changed) await writeStore(store);
  });
}

export async function listAnnouncements(): Promise<Announcement[]> {
  await ensureSeed();
  const store = await readStore();
  return [...store.items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const store = await readStore();
  return store.items.find((item) => item.id === id) ?? null;
}

export async function createAnnouncement(
  input: Omit<Announcement, "id" | "createdAt" | "updatedAt">,
): Promise<Announcement> {
  return withLock(async () => {
    const now = new Date().toISOString();
    const item: Announcement = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const store = await readStore();
    store.items.unshift(item);
    store.removedIds = (store.removedIds || []).filter((removedId) => removedId !== item.id);
    await writeStore(store);
    return item;
  });
}

export async function updateAnnouncement(
  id: string,
  patch: Partial<Omit<Announcement, "id" | "createdAt">>,
): Promise<Announcement | null> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const next: Announcement = {
      ...store.items[index],
      ...patch,
      id: store.items[index].id,
      createdAt: store.items[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    store.items[index] = next;
    store.removedIds = (store.removedIds || []).filter((removedId) => removedId !== id);
    await writeStore(store);
    return next;
  });
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.items.length;
    store.items = store.items.filter((item) => item.id !== id);
    if (store.items.length === before) return false;
    store.removedIds = Array.from(new Set([...(store.removedIds || []), id]));
    await writeStore(store);
    return true;
  });
}
