"use client";

import { BookOpen, Braces, KeyRound, Server } from "lucide-react";
import Link from "next/link";
import { PublicHeader, PublicPageIntro } from "@/app/public-header";

type RouteRow = {
  method: string;
  path: string;
  use: string;
  ret: string;
};

const nativeRoutes: RouteRow[] = [
  { method: "POST", path: "/ai/generate-image", use: "文生图 / 图生图 / 局部重绘（action: generate · img2img · infill）", ret: "ZIP（PNG 打包）" },
  { method: "POST", path: "/ai/generate-image-stream", use: "同上，msgpack 增量流式返回", ret: "x-msgpack 流" },
  { method: "POST", path: "/ai/upscale", use: "超分，固定 2x；仅 V5 双模型，输入 ≤1536×2048 的 base64 PNG", ret: "ZIP" },
  { method: "POST", path: "/ai/encode-vibe", use: "Vibe 参考图编码（支持多图）", ret: "JSON" },
  { method: "POST", path: "/ai/augment-image", use: "Director 工具：declutter · bg-removal · lineart · sketch · colorize · emotion（不支持 -limit 模型）", ret: "ZIP" },
  { method: "GET · POST", path: "/ai/generate-image/suggest-tags", use: "标签建议（?prompt=&model=）", ret: "JSON" },
];

const openaiRoutes: RouteRow[] = [
  { method: "POST", path: "/v1/images/generations", use: "文生图：{ model, prompt, size, n, steps, response_format }", ret: "JSON：data[].b64_json" },
  { method: "POST", path: "/v1/images/edits", use: "图生图 / 局部重绘：JSON 或 multipart（image · mask · prompt）", ret: "JSON：data[].b64_json" },
  { method: "GET", path: "/v1/models · /v1/model", use: "模型列表（仅 nai-* 前缀）", ret: "JSON" },
];

const appRoutes: RouteRow[] = [
  { method: "POST", path: "/api/auth/*", use: "登录、注册、2FA、令牌换取与会话登出", ret: "JSON（写入会话 Cookie）" },
  { method: "GET", path: "/api/me · /api/wallet", use: "当前账号信息、AFF 余额与图包额度", ret: "JSON" },
  { method: "POST", path: "/api/images/generate · /api/images/operate", use: "工作台生成与图像操作（超分、Director 等的站内入口）", ret: "JSON / 图片" },
  { method: "GET", path: "/api/history · /api/gallery", use: "个人历史与公开图片广场", ret: "JSON / 图片" },
  { method: "GET", path: "/api/pricing · /api/models · /api/usage · /api/public/catalog", use: "价格、模型目录、个人用量、公开价格快照", ret: "JSON" },
  { method: "GET · POST", path: "/api/keys", use: "LFN API 密钥管理（/ai 与 /v1 用的 Bearer 密钥在这里创建）", ret: "JSON" },
  { method: "GET · POST", path: "/api/announcements · /api/assistant · /api/aff", use: "公告与评论、标签助手、邀请返利", ret: "JSON" },
];

const nativeCurl = `curl -X POST '<站点地址>/ai/generate-image' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "input": "1girl, masterpiece",
    "model": "nai-diffusion-5-full",
    "action": "generate",
    "parameters": {
      "width": 832, "height": 1216,
      "steps": 28, "scale": 5,
      "sampler": "k_euler_ancestral",
      "seed": 0, "n_samples": 1,
      "negative_prompt": "lowres, bad hands"
    }
  }'

# 200 → application/zip，解压得到 PNG（与 NovelAI 官方一致）
# 流式改用 /ai/generate-image-stream，返回 x-msgpack 增量块`;

const openaiCurl = `curl -X POST '<站点地址>/v1/images/generations' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "nai-v5-full",
    "prompt": "1girl, masterpiece",
    "size": "832x1216",
    "n": 1,
    "steps": 28,
    "response_format": "b64_json"
  }'

# 200 → {"created": ..., "data": [{"b64_json": "<base64 PNG>"}]}`;

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg bg-[#292d2c] p-4 text-xs leading-5 text-[#e8e2d6]">{code}</pre>
  );
}

function RouteTable({ rows }: { rows: RouteRow[] }) {
  return (
    <div className="mt-4 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
      {rows.map((row) => (
        <div key={row.path} className="grid gap-1 p-3 text-xs sm:grid-cols-[auto_1fr_auto] sm:items-baseline sm:gap-3">
          <span className="w-fit shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--rose)]">{row.method}</span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[var(--ink)]">{row.path}</p>
            <p className="mt-0.5 leading-5 text-[var(--muted)]">{row.use}</p>
          </div>
          <span className="shrink-0 text-[var(--muted)]">→ {row.ret}</span>
        </div>
      ))}
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="docs" />
      <section className="mx-auto max-w-5xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="API / 接入文档"
          title="三种接入格式：NAI 原生、OpenAI 兼容、站内自有。"
          description="LFN 对外暴露三种 API 格式。/ai 与 /v1 面向外部工具，使用 LFN API 密钥并按张扣费；/api 是本站前端专用的自有格式。"
        />

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-semibold"><KeyRound size={14} className="text-[var(--rose)]" />鉴权</p>
            <p className="mt-1 text-[var(--muted)]">/ai 与 /v1：<code className="font-mono">Authorization: Bearer &lt;LFN API 密钥&gt;</code>，在<a href="/keys" className="text-[var(--rose)] hover:underline">API 密钥</a>页创建。/api：登录会话 Cookie，仅限本站前端。</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-semibold"><BookOpen size={14} className="text-[var(--rose)]" />计费</p>
            <p className="mt-1 text-[var(--muted)]">/ai 与 /v1 按张实时结算：图包额度优先，个人 AFF 补足；限速 10 张/分钟。参数在扣费前校验，非法请求直接 400。</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-semibold"><Server size={14} className="text-[var(--rose)]" />模型名</p>
            <p className="mt-1 text-[var(--muted)]">/ai 用 NovelAI 官方名（nai-diffusion-5-full），/v1 与站内用别名（nai-v5-full），两套可互换；完整对照见<a href="/models" className="text-[var(--rose)] hover:underline">模型目录</a>。</p>
          </div>
        </div>

        <article className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--rose)] text-white"><Braces size={20} /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">NovelAI native /ai</p>
              <h2 className="mt-1 font-[var(--font-display)] text-2xl">NovelAI 原生格式</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">请求体与响应和 NovelAI 官方 API 一致，可直接对接按官方格式编写的工具。错误响应为 JSON。</p>
            </div>
          </div>
          <RouteTable rows={nativeRoutes} />
          <CodeBlock code={nativeCurl} />
        </article>

        <article className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#292d2c] text-[#d9c9a5]"><Braces size={20} /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">OpenAI compatible /v1</p>
              <h2 className="mt-1 font-[var(--font-display)] text-2xl">OpenAI 兼容格式</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">标准 OpenAI 图像接口形状，适合只会说 OpenAI 协议的画图前端与集成工具。错误响应为 <code className="font-mono">{"{ error: { message } }"}</code>。</p>
            </div>
          </div>
          <RouteTable rows={openaiRoutes} />
          <CodeBlock code={openaiCurl} />
        </article>

        <article className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e6f3ed] text-[#28664f]"><Server size={20} /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">LFN app /api</p>
              <h2 className="mt-1 font-[var(--font-display)] text-2xl">站内自有格式</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">本站工作台与页面使用的自有 API，会话 Cookie 鉴权，格式不对外承诺兼容；外部工具请优先使用 /ai 或 /v1。</p>
            </div>
          </div>
          <RouteTable rows={appRoutes} />
        </article>

        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          价格与模型对照见<Link href="/pricing" className="text-[var(--rose)] hover:underline">价格页</Link>；实际扣费以服务端结算为准。
        </p>
      </section>
    </main>
  );
}
