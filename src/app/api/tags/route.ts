import { NextRequest, NextResponse } from "next/server";
import { outboundFetch } from "@/lib/outbound";

type DanbooruTag = {
  name: string;
  category: number;
  post_count: number;
};

// 常见中文词的直译捷径，未命中时回退到 Danbooru 自身的模糊匹配。
const chineseTerms: Record<string, string> = {
  女孩: "girl",
  男孩: "boy",
  白发: "white_hair",
  黑发: "black_hair",
  长发: "long_hair",
  短发: "short_hair",
  红眼: "red_eyes",
  蓝眼: "blue_eyes",
  绿眼: "green_eyes",
  微笑: "smile",
  和服: "kimono",
  校服: "school_uniform",
  猫耳: "cat_ears",
  风景: "scenery",
  夜晚: "night",
  雨: "rain",
  花: "flower",
};

type AutocompleteItem = {
  value?: string;
  category?: number;
  post_count?: number;
};
const categoryNames: Record<number, string> = {
  0: "通用",
  1: "画师",
  3: "作品",
  4: "角色",
  5: "元数据",
};
const cache = new Map<string, { expiresAt: number; data: unknown }>();
const requests = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const MAX_TRACKED_CLIENTS = 5_000;

// X-Forwarded-For 可被客户端伪造，只有部署在受信代理后才允许采信。
function clientKey(request: NextRequest): string {
  if (process.env.LFN_TRUST_PROXY === "true") {
    const forwarded = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (forwarded) return forwarded;
  }
  return "shared";
}

function overRateLimit(key: string, now: number): boolean {
  for (const [tracked, times] of requests) {
    if (times.every((time) => now - time >= RATE_WINDOW_MS))
      requests.delete(tracked);
  }
  if (requests.size >= MAX_TRACKED_CLIENTS && !requests.has(key)) return true;
  const recent = (requests.get(key) || []).filter(
    (time) => now - time < RATE_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT) {
    requests.set(key, recent);
    return true;
  }
  recent.push(now);
  requests.set(key, recent);
  return false;
}

type TagHit = {
  name: string;
  displayName: string;
  category: number;
  categoryName: string;
  postCount: number;
};

function toHit(name: string, category: number, postCount: number): TagHit {
  return {
    name,
    displayName: name.replaceAll("_", " "),
    category,
    categoryName: categoryNames[category] || "其他",
    postCount,
  };
}

async function danbooru(path: string, params: URLSearchParams): Promise<unknown> {
  const response = await outboundFetch(
    `https://danbooru.donmai.us/${path}?${params}`,
    {
      headers: { "User-Agent": "Love-for-NAI/0.1 (tag search)" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("Danbooru 查询失败");
  return response.json();
}

async function matchByName(keyword: string): Promise<TagHit[]> {
  const tags = (await danbooru(
    "tags.json",
    new URLSearchParams({
      "search[name_matches]": `*${keyword}*`,
      "search[order]": "count",
      limit: "16",
    }),
  )) as DanbooruTag[];
  return tags.map((tag) => toHit(tag.name, tag.category, tag.post_count));
}

async function matchByWords(keyword: string): Promise<TagHit[]> {
  const items = (await danbooru(
    "autocomplete.json",
    new URLSearchParams({
      "search[query]": keyword.replaceAll("_", " "),
      "search[type]": "tag_query",
      limit: "16",
    }),
  )) as AutocompleteItem[];
  return items
    .filter((item) => typeof item.value === "string")
    .map((item) =>
      toHit(item.value as string, item.category ?? 0, item.post_count ?? 0),
    );
}

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (rawQuery.length < 2 || rawQuery.length > 80)
    return NextResponse.json(
      { message: "请输入 2–80 个字符的标签关键词" },
      { status: 400 },
    );

  const now = Date.now();
  if (overRateLimit(clientKey(request), now))
    return NextResponse.json(
      { message: "标签搜索过于频繁，请稍后再试" },
      { status: 429 },
    );

  const normalized = (chineseTerms[rawQuery] || rawQuery)
    .toLowerCase()
    .replaceAll(" ", "_");
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now) return NextResponse.json(cached.data);

  try {
    let tags = await matchByName(normalized);
    // name_matches 只做整串通配，多词或部分词需要 autocomplete 的词级匹配。
    if (!tags.length) tags = await matchByWords(normalized);
    const data = {
      query: rawQuery,
      normalizedQuery: normalized,
      tags,
    };
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size >= 1_000) cache.clear();
    cache.set(normalized, { expiresAt: now + 5 * 60_000, data });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接 Danbooru，请稍后重试" },
      { status: 502 },
    );
  }
}
