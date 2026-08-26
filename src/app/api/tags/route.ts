import { NextRequest, NextResponse } from "next/server";
import { outboundFetch } from "@/lib/outbound";
import { SlidingWindowRateLimiter, trustedClientKey } from "@/lib/rate-limit";

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
const RATE_WINDOW_MS = 60_000;
const clientLimiter = new SlidingWindowRateLimiter({
  limit: 30,
  windowMs: RATE_WINDOW_MS,
});
// 无法可信识别客户端时使用更宽松的站点级保护，避免所有用户共享 30 次额度。
const globalLimiter = new SlidingWindowRateLimiter({
  limit: 600,
  windowMs: RATE_WINDOW_MS,
  maxKeys: 1,
});

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

async function danbooru(
  path: string,
  params: URLSearchParams,
): Promise<unknown> {
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
  const globalRate = globalLimiter.check("global", now);
  const client = trustedClientKey(request);
  const clientRate = client ? clientLimiter.check(client, now) : null;
  const rejectedRate = !globalRate.allowed
    ? globalRate
    : clientRate && !clientRate.allowed
      ? clientRate
      : null;
  if (rejectedRate)
    return NextResponse.json(
      { message: "标签搜索过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(rejectedRate.retryAfterSeconds) },
      },
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
