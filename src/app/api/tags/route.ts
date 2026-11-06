import { NextRequest, NextResponse } from "next/server";
import { outboundFetch } from "@/lib/outbound";
import { SlidingWindowRateLimiter, trustedClientKey } from "@/lib/rate-limit";
import { autocompleteTagTranslation, canonicalTagForChineseAlias, matchBundledTagTranslations, tagZh } from "@/lib/tag-translations";
import { readCatalogTag, searchTagCatalog, searchTagCatalogAutocomplete, tagCatalogStatus } from "@/lib/tag-catalog";
import { isPromptCompletionQuery, normalizePromptCompletionQuery, promptCompletionHitRank, type PromptCompletion } from "@/lib/prompt-completion";

type DanbooruTag = {
  name: string;
  category: number;
  post_count: number;
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
  // 中文翻译（Aaalice 词库勘误表，无翻译时省略）。
  zh?: string;
};
type AutocompleteTag = PromptCompletion & { deprecated?: boolean };

function toHit(name: string, category: number, postCount: number): TagHit {
  const zh = tagZh(name);
  return {
    name,
    displayName: name.replaceAll("_", " "),
    category,
    categoryName: categoryNames[category] || "其他",
    postCount,
    ...(zh ? { zh } : {}),
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

function rankAutocompleteTags(hits: AutocompleteTag[], query: string) {
  return hits.map((hit) => ({ hit, rank: promptCompletionHitRank(query, hit) }))
    .sort((a, b) => a.rank - b.rank || Number(Boolean(a.hit.deprecated)) - Number(Boolean(b.hit.deprecated))
      || (b.hit.postCount ?? 0) - (a.hit.postCount ?? 0) || a.hit.name.length - b.hit.name.length || a.hit.name.localeCompare(b.hit.name))
    .slice(0, 10).map(({ hit }) => hit);
}

function localAutocompleteTags(query: string, chinese: boolean) {
  const hits = new Map<string, AutocompleteTag>(searchTagCatalogAutocomplete(query).map((hit) => [hit.name, hit]));
  if (chinese) {
    for (const bundled of matchBundledTagTranslations(query)) {
      const catalog = hits.get(bundled.name);
      if (!catalog) {
        hits.set(bundled.name, { ...bundled, displayName: bundled.name.replaceAll("_", " "), categoryName: "本地词表", local: true });
      } else if (promptCompletionHitRank(query, bundled) < promptCompletionHitRank(query, catalog)) {
        hits.set(bundled.name, { ...catalog, zh: bundled.zh });
      }
    }
  }
  return rankAutocompleteTags([...hits.values()], query);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") return NextResponse.json(tagCatalogStatus(), { headers: { "Cache-Control": "no-store" } });
  const catalogKey = request.nextUrl.searchParams.get("key");
  if (catalogKey) {
    if (catalogKey.length > 512) return NextResponse.json({ message: "标签标识过长" }, { status: 400 });
    const item = readCatalogTag(catalogKey);
    return NextResponse.json(item ? { item } : { message: "未找到标签" }, { status: item ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  }
  const rawQuery = request.nextUrl.searchParams.get("q")?.trim() || "";
  const autocomplete = request.nextUrl.searchParams.get("mode") === "autocomplete";
  const normalized = autocomplete ? normalizePromptCompletionQuery(rawQuery).replaceAll(" ", "_")
    : (canonicalTagForChineseAlias(rawQuery) || rawQuery).toLowerCase().replaceAll(" ", "_");
  const chinese = /\p{Script=Han}/u.test(normalized);
  if (rawQuery.length > 80 || (autocomplete ? !isPromptCompletionQuery(normalized) : rawQuery.length < 2))
    return NextResponse.json(
      { message: autocomplete ? "请输入 1–80 个中文字符或 2–80 个其他字符" : "请输入 2–80 个字符的标签关键词" },
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

  if (autocomplete) {
    const tags = localAutocompleteTags(normalized, chinese);
    if (tags.length || chinese) {
      return NextResponse.json({ query: rawQuery, normalizedQuery: normalized, tags }, { headers: { "Cache-Control": "no-store" } });
    }
  } else {
    const catalog = searchTagCatalog(normalized, 10);
    if (catalog?.length) return NextResponse.json({ query: rawQuery, normalizedQuery: normalized, tags: catalog, source: "catalog" }, { headers: { "Cache-Control": "no-store" } });
  }
  const cacheKey = autocomplete ? `autocomplete:${normalized}` : normalized;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return NextResponse.json(cached.data);

  try {
    let tags = await (autocomplete ? matchByWords(normalized).catch(() => []) : matchByName(normalized));
    if (!tags.length) tags = await (autocomplete ? matchByName(normalized) : matchByWords(normalized));
    const data = {
      query: rawQuery,
      normalizedQuery: normalized,
      tags: autocomplete ? rankAutocompleteTags(tags.map((tag) => ({ ...tag, zh: autocompleteTagTranslation(tag.name) })), normalized) : tags,
    };
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size >= 1_000) cache.clear();
    cache.set(cacheKey, { expiresAt: now + 5 * 60_000, data });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接 Danbooru，请稍后重试" },
      { status: 502 },
    );
  }
}
