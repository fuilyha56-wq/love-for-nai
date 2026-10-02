"use client";

import { BookOpen, Braces, Check, Copy, KeyRound, Server } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
  { method: "POST", path: "/ai/upscale", use: "独立超分，固定 2x；仅 V5 双模型，输入 ≤1536×2048 的 base64 PNG", ret: "ZIP" },
  { method: "POST", path: "/ai/encode-vibe", use: "Vibe 参考图编码（image 或 images[]，按图计费）", ret: "JSON" },
  { method: "POST", path: "/ai/augment-image", use: "Director 工具：declutter · bg-removal · lineart · sketch · colorize · emotion（不支持 -limit 模型）", ret: "ZIP" },
  { method: "POST", path: "/ai/annotate-image", use: "图像标注（构图线稿等，默认模型 hed）", ret: "ZIP" },
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
      "noise_schedule": "karras",
      "seed": 0, "n_samples": 1,
      "negative_prompt": "lowres, bad hands"
    }
  }'

# 200 → application/zip，解压得到 PNG（与 NovelAI 官方一致）
# 流式改用 /ai/generate-image-stream，返回 x-msgpack 增量块`;

const nativeActionCurl = `# action 决定图像操作：generate（文生图）| img2img（图生图）| infill（局部重绘）
# img2img / infill 需要 parameters 携带源图；局部重绘请使用对应 inpainting 模型名
curl -X POST '<站点地址>/ai/generate-image' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "input": "repair the masked area",
    "model": "nai-diffusion-4-5-full-inpainting",
    "action": "infill",
    "parameters": {
      "width": 832, "height": 1216,
      "steps": 23, "scale": 5, "seed": 3100581094,
      "image": "<BASE64_PNG>",
      "mask": "<BASE64_MASK_同原图尺寸>",
      "strength": 0.7, "noise": 0
    }
  }'

# mask 规则：白色表示重绘、黑色表示保留；必须与源图同尺寸、
# 8x8 网格对齐、纯黑白且完全不透明`;

const nativeVibeParams = `// Vibe 编码与精确参考都是 parameters 里的可选字段
// 参考图（Vibe + 精确参考合计）上限 12 张
{
  "reference_image_multiple": ["<VIBE_ENCODING>"],
  "reference_strength_multiple": [0.6],
  "reference_information_extracted_multiple": [0.7],
  "director_reference_images": ["<BASE64_PNG>"],
  "director_reference_descriptions": [{
    "caption": { "base_caption": "character&style", "char_captions": [] },
    "legacy_uc": false
  }],
  "director_reference_strength_values": [1],
  "director_reference_secondary_strength_values": [0.2],
  "director_reference_information_extracted": [1]
}

// Vibe 编码本体是独立路由：{"image": "<BASE64_PNG>"} 或 {"images": [...]}
curl -X POST '<站点地址>/ai/encode-vibe' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{"model": "nai-diffusion-4-5-full", "image": "<BASE64_PNG>", "information_extracted": 0.7}'`;

const nativeToolsCurl = `# 独立 2x 超分：仅 V5 双模型，declared_blur_sigma 固定 0
# 输入必须是 base64 PNG，面积 ≤ 1536x2048；费用按输入面积换算
curl -X POST '<站点地址>/ai/upscale' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{"model": "nai-diffusion-5-curated", "image": "<BASE64_PNG>", "declared_blur_sigma": 0}'

# Director：req_type 取 declutter / bg-removal / lineart / sketch / colorize / emotion
# 不支持 -limit 模型；可选 prompt、defry 控制效果强度
curl -X POST '<站点地址>/ai/augment-image' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{"req_type": "colorize", "model": "nai-diffusion-4-5-full", "image": "<BASE64_PNG>",
       "width": 832, "height": 1216, "prompt": "warm light", "defry": 3}'

# 构图标注（默认模型 hed）
curl -X POST '<站点地址>/ai/annotate-image' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{"image": "<BASE64_PNG>"}'`;

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

const openaiEditsCurl = `# 只提供 image 是图生图；image + mask 是局部重绘
# JSON（data URL）与 multipart/form-data 两种编码都支持
curl -X POST '<站点地址>/v1/images/edits' \\
  -H 'Authorization: Bearer <LFN_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "nai-v4.5-inpaint",
    "prompt": "repair the masked area",
    "image": "data:image/png;base64,<BASE64_PNG>",
    "mask": "data:image/png;base64,<BASE64_MASK_同原图尺寸>",
    "size": "832x1216",
    "response_format": "b64_json",
    "steps": 23,
    "strength": 0.7
  }'

# multipart 时 image / mask 直接传二进制文件部件，其余字段为表单字段
# 当前响应只返回 b64_json；图像操作类型（图生图/局部重绘）由服务端自动推断`;

type ModelRow = {
  native: string;
  alias: string;
  version: string;
  abilities: string;
};

const modelRows: ModelRow[] = [
  { native: "nai-diffusion-5-full", alias: "nai-v5-full", version: "V5", abilities: "文生图 · 流式 · 独立超分 · Vibe · 精确参考" },
  { native: "nai-diffusion-5-curated", alias: "nai-v5-curated", version: "V5", abilities: "文生图 · 流式 · 独立超分 · Vibe · 精确参考" },
  { native: "nai-diffusion-5-inpainting", alias: "nai-v5-inpaint", version: "V5", abilities: "局部重绘 · 流式" },
  { native: "nai-diffusion-4-5-full", alias: "nai-v4.5-full", version: "V4.5", abilities: "文生图 · 流式 · Vibe · 精确参考" },
  { native: "nai-diffusion-4-5-curated", alias: "nai-v4.5-curated", version: "V4.5", abilities: "文生图 · 流式 · Vibe · 精确参考" },
  { native: "nai-diffusion-4-5-full-inpainting", alias: "nai-v4.5-inpaint", version: "V4.5", abilities: "局部重绘 · 流式" },
  { native: "nai-diffusion-4-full", alias: "nai-v4-full", version: "V4", abilities: "文生图 · Vibe · 精确参考" },
  { native: "nai-diffusion-4-curated-preview", alias: "nai-v4-curated", version: "V4", abilities: "文生图 · Vibe · 精确参考" },
  { native: "nai-diffusion-3", alias: "nai-v3", version: "V3", abilities: "文生图 · Vibe · SMEA" },
  { native: "nai-diffusion-furry-3", alias: "nai-v3-furry", version: "V3", abilities: "文生图 · Vibe · SMEA" },
  { native: "nai-diffusion-3-inpainting", alias: "nai-v3-inpaint", version: "V3", abilities: "局部重绘" },
  { native: "nai-diffusion-furry-3-inpainting", alias: "nai-v3-furry-inpaint", version: "V3", abilities: "局部重绘" },
];

const errorRows: Array<{ code: string; when: string }> = [
  { code: "400", when: "参数校验失败：尺寸、张数、模型名、mask 不合法等，返回 { message } 或 { error: { message } }" },
  { code: "401", when: "缺少或非法的 Authorization: Bearer <LFN_API_KEY>" },
  { code: "404", when: "模型或端点不存在（模型能力以 GET /v1/models 为准）" },
  { code: "413", when: "请求体超过 25 MiB 上限" },
  { code: "415", when: "Content-Type 不被接受（/v1/images/generations 仅 JSON；edits 支持 JSON 或 multipart）" },
  { code: "429", when: "触发限速，响应带 Retry-After 头" },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };
  return (
    <div className="relative mt-4">
      <button
        type="button"
        onClick={copy}
        aria-label="复制代码"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded bg-white/10 text-[#e8e2d6] hover:bg-white/20"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre className="mt-0 overflow-x-auto rounded-lg bg-[#292d2c] p-4 pr-11 text-xs leading-5 text-[#e8e2d6]">{code}</pre>
    </div>
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

function SectionHead({ eyebrow, title, description, dark }: { eyebrow: string; title: string; description: React.ReactNode; dark?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${dark ? "bg-[#292d2c] text-[#d9c9a5]" : "bg-[var(--rose)] text-white"}`}><Braces size={20} /></div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">{eyebrow}</p>
        <h2 className="mt-1 font-[var(--font-display)] text-2xl">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{description}</p>
      </div>
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

        <nav aria-label="文档目录" className="mt-5 flex flex-wrap gap-2 text-xs">
          {[
            ["#docs-auth", "鉴权"],
            ["#docs-native", "原生格式 /ai"],
            ["#docs-openai", "OpenAI 兼容 /v1"],
            ["#docs-models", "模型与能力"],
            ["#docs-limits", "错误与限制"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]">{label}</a>
          ))}
        </nav>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div id="docs-auth" className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6 scroll-mt-24">
            <p className="flex items-center gap-1.5 font-semibold"><KeyRound size={14} className="text-[var(--rose)]" />鉴权</p>
            <p className="mt-1 text-[var(--muted)]">/ai 与 /v1：<code className="font-mono">Authorization: Bearer &lt;LFN API 密钥&gt;</code>，在<a href="/keys" className="text-[var(--rose)] hover:underline">API 密钥</a>页创建。/api：登录会话 Cookie，仅限本站前端。</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-semibold"><BookOpen size={14} className="text-[var(--rose)]" />计费</p>
            <p className="mt-1 text-[var(--muted)]">/ai 与 /v1 按张实时结算：图包额度优先，个人 AFF 补足；参数在扣费前校验，非法请求直接 400。实际生成张数少于请求时按张退款。</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-semibold"><Server size={14} className="text-[var(--rose)]" />模型名</p>
            <p className="mt-1 text-[var(--muted)]">/ai 用 NovelAI 官方名（nai-diffusion-5-full），/v1 与站内用别名（nai-v5-full），两套可互换；完整对照见<a href="/models" className="text-[var(--rose)] hover:underline">模型目录</a>。</p>
          </div>
        </div>

        <article id="docs-native" className="mt-8 scroll-mt-24 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <SectionHead
            eyebrow="NovelAI native /ai"
            title="NovelAI 原生格式"
            description={<>请求体与响应和 NovelAI 官方 API 一致，可直接对接按官方格式编写的工具。错误响应为 JSON。图像尺寸需为 8 的倍数、单边 64–1600；n_samples 上限 30。</>}
          />
          <RouteTable rows={nativeRoutes} />
          <h3 className="mt-6 text-sm font-semibold">完整文生图请求</h3>
          <CodeBlock code={nativeCurl} />
          <h3 className="mt-6 text-sm font-semibold">图生图与局部重绘</h3>
          <CodeBlock code={nativeActionCurl} />
          <h3 className="mt-6 text-sm font-semibold">Vibe 与精确参考参数</h3>
          <CodeBlock code={nativeVibeParams} />
          <h3 className="mt-6 text-sm font-semibold">独立工具请求</h3>
          <CodeBlock code={nativeToolsCurl} />
        </article>

        <article id="docs-openai" className="mt-6 scroll-mt-24 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <SectionHead
            eyebrow="OpenAI compatible /v1"
            title="OpenAI 兼容格式"
            dark
            description={<>标准 OpenAI 图像接口形状，适合只会说 OpenAI 协议的画图前端与集成工具。错误响应为 <code className="font-mono">{"{ error: { message } }"}</code>。</>}
          />
          <RouteTable rows={openaiRoutes} />
          <h3 className="mt-6 text-sm font-semibold">文生图</h3>
          <CodeBlock code={openaiCurl} />
          <h3 className="mt-6 text-sm font-semibold">图生图与局部重绘 · /v1/images/edits</h3>
          <CodeBlock code={openaiEditsCurl} />
        </article>

        <article id="docs-models" className="mt-6 scroll-mt-24 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <SectionHead
            eyebrow="Models"
            title="模型与能力"
            description={<>同一模型在 /ai 用官方名、在 /v1 用别名。目录以 GET /v1/models 实时返回为准；模型列表也可能包含 -limit 变体（仅限特定 NewAPI 渠道），Director 与超分工具不支持 -limit。</>}
          />
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)]">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)]">
                  <th className="px-3 py-2 font-semibold">官方名（/ai）</th>
                  <th className="px-3 py-2 font-semibold">别名（/v1 · 站内）</th>
                  <th className="px-3 py-2 font-semibold">版本</th>
                  <th className="px-3 py-2 font-semibold">能力</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {modelRows.map((row) => (
                  <tr key={row.native} className="leading-5">
                    <td className="px-3 py-2 font-mono text-[var(--ink)]">{row.native}</td>
                    <td className="px-3 py-2 font-mono text-[var(--muted)]">{row.alias}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{row.version}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{row.abilities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article id="docs-app" className="mt-6 scroll-mt-24 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <SectionHead
            eyebrow="LFN app /api"
            title="站内自有格式"
            description="本站工作台与页面使用的自有 API，会话 Cookie 鉴权，格式不对外承诺兼容；外部工具请优先使用 /ai 或 /v1。"
          />
          <RouteTable rows={appRoutes} />
        </article>

        <article id="docs-limits" className="mt-6 scroll-mt-24 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
          <SectionHead
            eyebrow="Errors & Limits"
            title="错误与限制"
            description="所有硬限制都在服务端扣费前校验，非法请求不会产生任何扣费。"
          />
          <ul className="mt-4 grid gap-2 text-xs leading-6 text-[var(--muted)]">
            <li>· 尺寸：单边 64–1600 且为 8 的倍数，总面积 ≤ 1600×1600；超分输入面积 ≤ 1536×2048（固定 2x 输出）。</li>
            <li>· 张数：n / n_samples 1–30（两者同时提供时必须一致）；步数 1–50，默认 28。</li>
            <li>· 参考图：Vibe 与精确参考合计 ≤ 12 张；请求体上限 25 MiB。</li>
            <li>· 限速：每密钥 30 次图像请求 / 分钟（滑动窗口），超出返回 429 并带 Retry-After。</li>
            <li>· 扣费顺序：图包额度优先，个人 AFF 补足，两者都不足时经托管密钥按 NewAPI 分组计费；部分失败按实际生成张数退款。</li>
          </ul>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)]">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)]">
                  <th className="px-3 py-2 font-semibold">状态码</th>
                  <th className="px-3 py-2 font-semibold">含义</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {errorRows.map((row) => (
                  <tr key={row.code} className="leading-5">
                    <td className="px-3 py-2 font-mono text-[var(--rose)]">{row.code}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{row.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-[var(--muted)]">
            排查顺序：先确认 API 密钥状态，再调用 GET /v1/models 核对模型目录，最后检查图片尺寸与张数限制。
          </p>
        </article>

        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          价格与模型对照见<Link href="/pricing" className="text-[var(--rose)] hover:underline">价格页</Link>；实际扣费以服务端结算为准。
        </p>
      </section>
    </main>
  );
}
