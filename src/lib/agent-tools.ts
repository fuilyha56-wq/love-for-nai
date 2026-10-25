import { outboundFetch } from "@/lib/outbound";
import { readCatalogTag, searchTagCatalog, tagCatalogStatus } from "@/lib/tag-catalog";
import { runQuickTagCloudTool } from "@/lib/quicktagcloud";

export type ToolResult = { ok: boolean; data: unknown };

const categoryNames: Record<number, string> = {
  0: "通用",
  1: "画师",
  3: "作品",
  4: "角色",
  5: "元数据",
};

type AutocompleteItem = {
  value?: string;
  label?: string;
  category?: number;
  post_count?: number;
};
type DanbooruTag = { name: string; category: number; post_count: number };
type WikiPage = { title?: string; body?: string; other_names?: string[] };

async function danbooru(path: string, params: URLSearchParams): Promise<unknown> {
  const response = await outboundFetch(
    `https://danbooru.donmai.us/${path}?${params}`,
    {
      headers: { "User-Agent": "Love-for-NAI/0.1 (tag agent)" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Danbooru 返回 ${response.status}`);
  return response.json();
}

// autocomplete 支持词级模糊匹配，比 name_matches 更贴近人工检索习惯。
async function searchDanbooruTags(query: string): Promise<ToolResult> {
  const keyword = query.trim().toLowerCase().replaceAll(" ", "_");
  if (!keyword) return { ok: false, data: "关键词为空" };
  try {
    const items = (await danbooru(
      "autocomplete.json",
      new URLSearchParams({
        "search[query]": keyword,
        "search[type]": "tag_query",
        limit: "12",
      }),
    )) as AutocompleteItem[];
    const tags = items
      .filter((item) => typeof item.value === "string")
      .map((item) => ({
        name: item.value as string,
        category: categoryNames[item.category ?? 0] || "其他",
        postCount: item.post_count ?? 0,
      }));
    if (!tags.length)
      return { ok: true, data: { query: keyword, tags: [], source: "danbooru_online", note: "无匹配标签" } };
    return { ok: true, data: { query: keyword, tags, source: "danbooru_online" } };
  } catch (error) {
    return {
      ok: false,
      data: error instanceof Error ? error.message : "Danbooru 检索失败",
    };
  }
}

async function verifyDanbooruTag(name: string): Promise<ToolResult> {
  const normalized = name.trim().toLowerCase().replaceAll(" ", "_");
  if (!normalized) return { ok: false, data: "标签名为空" };
  try {
    const [tag] = (await danbooru(
      "tags.json",
      new URLSearchParams({ "search[name]": normalized, limit: "1" }),
    )) as DanbooruTag[];
    if (!tag || tag.name !== normalized)
      return { ok: true, data: { name: normalized, exists: false, source: "danbooru_online" } };
    return {
      ok: true,
      data: {
        name: tag.name,
        source: "danbooru_online",
        exists: true,
        category: categoryNames[tag.category] || "其他",
        postCount: tag.post_count,
      },
    };
  } catch (error) {
    return {
      ok: false,
      data: error instanceof Error ? error.message : "Danbooru 校验失败",
    };
  }
}

async function readDanbooruWiki(title: string): Promise<ToolResult> {
  const normalized = title.trim().toLowerCase().replaceAll(" ", "_");
  if (!normalized) return { ok: false, data: "词条名为空" };
  try {
    const pages = (await danbooru(
      "wiki_pages.json",
      new URLSearchParams({ "search[title]": normalized, limit: "1" }),
    )) as WikiPage[];
    const page = pages[0];
    if (!page) return { ok: true, data: { title: normalized, found: false, source: "danbooru_online" } };
    return {
      ok: true,
      data: {
        title: page.title,
        source: "danbooru_online",
        found: true,
        otherNames: page.other_names ?? [],
        body: page.body || "",
      },
    };
  } catch (error) {
    return {
      ok: false,
      data: error instanceof Error ? error.message : "Danbooru 词条读取失败",
    };
  }
}

type WikipediaResult = [string, string[], string[], string[]];

// 公共 SearXNG 实例普遍限流，这里用可稳定访问的百科接口做概念检索。
async function wikipediaSearch(
  language: string,
  query: string,
): Promise<Array<{ title: string; url: string }>> {
  const response = await outboundFetch(
    `https://${language}.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "opensearch",
      search: query,
      limit: "5",
      format: "json",
    })}`,
    {
      headers: { "User-Agent": "Love-for-NAI/0.1 (concept lookup)" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Wikipedia 返回 ${response.status}`);
  const [, titles, , urls] = (await response.json()) as WikipediaResult;
  return (titles || []).map((title, index) => ({
    title,
    url: urls?.[index] || "",
  }));
}

async function webSearch(query: string): Promise<ToolResult> {
  const keyword = query.trim();
  if (!keyword) return { ok: false, data: "查询为空" };
  const languages = /[\u4e00-\u9fa5]/.test(keyword) ? ["zh", "en"] : ["en"];
  const results: Array<{ title: string; url: string; source: string }> = [];
  const failures: string[] = [];

  for (const language of languages) {
    try {
      const hits = await wikipediaSearch(language, keyword);
      results.push(
        ...hits.map((hit) => ({ ...hit, source: `${language}.wikipedia` })),
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "查询失败");
    }
  }

  if (!results.length)
    return {
      ok: false,
      data: failures.length ? failures.join("; ") : "没有找到网络结果",
    };
  return { ok: true, data: { query: keyword, results: results.slice(0, 8) } };
}

// 把工具结果压成一句中文摘要，供检索过程展示。
export function summarizeToolResult(name: string, data: unknown): string {
  const payload = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  if (typeof data === "string") return data;
  if (typeof payload.message === "string") return payload.message;
  switch (name) {
    case "list_quicktagcloud_codexes":
      return `在线目录 ${count(payload.codexes)} 个 · ${String(payload.release || "")}`;
    case "search_quicktagcloud_tags":
      return `在线匹配 ${Number(payload.total || 0)} 条，展示 ${count(payload.entries)} 条 · ${String(payload.codexId || "")}`;
    case "read_quicktagcloud_entry":
      return payload.found ? `在线完整词条 · ${String(payload.codexId)} / ${String(payload.entryId)}` : "在线未找到词条";
    case "search_tag_catalog": {
      if (Array.isArray(payload.queries)) {
        return payload.queries
          .map((entry) => {
            const query = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
            return `${String(query.query || "关键词")} ${count(query.tags)} 条`;
          })
          .join("；");
      }
      return `标签库匹配 ${count(payload.tags)} 条`;
    }
    case "read_tag_catalog": {
      if (Array.isArray(payload.tags))
        return `读取完整介绍 ${count(payload.tags)} 条${Array.isArray(payload.missing) && payload.missing.length ? `，${payload.missing.length} 条无独立词条` : ""}`;
      return payload.name ? `完整介绍：${String(payload.displayName || payload.name)}` : "未找到词条";
    }
    case "tag_catalog_status":
      return payload.complete ? "标签库已完成同步" : "标签库正在同步";
    case "search_danbooru_tags": {
      const total = count(payload.tags);
      return total
        ? `检索到 ${total} 个候选标签`
        : String(payload.note || "无匹配标签");
    }
    case "verify_danbooru_tag":
      return payload.exists
        ? `存在 · ${Number(payload.postCount || 0).toLocaleString("zh-CN")} 图`
        : "标签不存在";
    case "read_danbooru_wiki":
      return payload.found ? `词条：${String(payload.title)}` : "无词条";
    case "web_search": {
      const total = count(payload.results);
      return total ? `${total} 条概念结果` : "无网络结果";
    }
    default:
      return "完成";
  }
}

/** 返回给文本协议 agent 的可调用工具说明。 */
export function toolCatalog(): string {
  return [
    "- search_tag_catalog: 参数 {query: string, source?: 'danbooru'|'quicktagcloud'} 或 {queries: string[], source?: 'danbooru'|'quicktagcloud'}。检索本地完整数据库，可指定来源；queries 一次最多 8 项，每项最多 6 条。返回候选摘要和 catalogKey，不会自动附上整套组合提示词；选中后再 read_tag_catalog 读取。精确独立标签优先，组合提示词须核对与任务的相关性。",
    "- read_tag_catalog: 参数 {key: string} 或 {keys: string[]}。按 catalogKey 或标签名读取完整介绍、来源、原始记录和全部词条；keys 一次最多 6 个。需要解释多个标签时必须一次批量读取。原站没有介绍时明确返回 missing，不得编造为官方定义。",
    "- tag_catalog_status: 参数 {}。查看各数据源版本、抓取完整性和条目数量。",
    "- search_danbooru_tags: 参数 {query: string}。实时联网检索 Danbooru，返回标签名、分类和图片数，不替换为本地查询。",
    "- verify_danbooru_tag: 参数 {name: string}。实时联网精确校验 Danbooru 标签。",
    "- read_danbooru_wiki: 参数 {title: string}。实时联网读取 Danbooru 词条说明和别名。",
    "- list_quicktagcloud_codexes: 参数 {}。联网读取 QuickTagCloud 当前发布版本和目录（2 分钟缓存），供选择 codexId。",
    "- search_quicktagcloud_tags: 参数 {codexId: string, query: string}。联网搜索所选 QuickTagCloud 目录的全部词条，返回候选标题、路径、entryId、匹配词及原站链接，最多展示 12 条；不附上未选中的组合提示词。",
    "- read_quicktagcloud_entry: 参数 {codexId: string, entryId: string}。读取已选在线 QuickTagCloud 词条的完整原始内容、提示词和来源；发布文件按原站清单校验。",
    "- web_search: 参数 {query: string}。检索 Wikipedia 概念结果，用于把中文或小众概念转换为英文检索词。",
  ].join("\n");
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const text = (key: string) =>
    typeof args[key] === "string" ? (args[key] as string) : "";
  switch (name) {
    case "list_quicktagcloud_codexes":
    case "search_quicktagcloud_tags":
    case "read_quicktagcloud_entry":
      return runQuickTagCloudTool(name, args);
    case "search_tag_catalog": {
      if (args.source !== undefined && args.source !== "danbooru" && args.source !== "quicktagcloud")
        return { ok: false, data: "本地来源必须是 danbooru 或 quicktagcloud" };
      const source = args.source as "danbooru" | "quicktagcloud" | undefined;
      const search = (query: string) => {
        const normalized = query.trim().toLowerCase().replaceAll(" ", "_");
        const precise = source ? [] : searchTagCatalog(query, 6, "danbooru") || [];
        const tags = precise.some((tag) => tag.name === normalized)
          ? precise : searchTagCatalog(query, 6, source) || [];
        return tags.map((tag) => tag.source === "quicktagcloud" ? {
          catalogKey: tag.catalogKey, source: tag.source, displayName: tag.displayName,
          categoryName: tag.categoryName, matchedQuery: query, hasPrompt: Boolean(tag.insertion),
          hasDescription: tag.hasDescription, descriptionUrl: tag.descriptionUrl,
        } : tag);
      };
      const queries = Array.isArray(args.queries)
        ? [...new Set(args.queries.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 8)
        : [];
      if (queries.length) {
        return {
          ok: true,
          data: {
            source: "local_catalog",
            catalogSource: source || "all",
            queries: queries.map((query) => ({ query, tags: search(query) })),
            status: tagCatalogStatus(),
          },
        };
      }
      return { ok: true, data: { source: "local_catalog", catalogSource: source || "all", tags: search(text("query")), status: tagCatalogStatus() } };
    }
    case "read_tag_catalog": {
      const keys = Array.isArray(args.keys)
        ? [...new Set(args.keys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 6)
        : [];
      if (keys.length) {
        const found = keys.flatMap((key) => {
          const item = readCatalogTag(key);
          return item ? [item] : [];
        });
        const foundKeys = new Set(found.flatMap((item) => [String(item.catalogKey), String(item.name)]));
        const missing = keys.filter((key) => {
          const normalized = key.toLowerCase().replaceAll(" ", "_");
          return !foundKeys.has(key) && !foundKeys.has(normalized);
        });
        return { ok: found.length > 0, data: { tags: found, missing } };
      }
      const item = readCatalogTag(text("key") || text("name"));
      return { ok: Boolean(item), data: item || { found: false } };
    }
    case "tag_catalog_status":
      return { ok: true, data: tagCatalogStatus() };
    case "search_danbooru_tags":
      return searchDanbooruTags(text("query"));
    case "verify_danbooru_tag":
      return verifyDanbooruTag(text("name"));
    case "read_danbooru_wiki":
      return readDanbooruWiki(text("title"));
    case "web_search":
      return webSearch(text("query"));
    default:
      return { ok: false, data: `未知工具 ${name}` };
  }
}
