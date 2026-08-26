import { outboundFetch } from "@/lib/outbound";

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

async function danbooru(
  path: string,
  params: URLSearchParams,
): Promise<unknown> {
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
      return {
        ok: true,
        data: { query: keyword, tags: [], note: "无匹配标签" },
      };
    return { ok: true, data: { query: keyword, tags } };
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
      return { ok: true, data: { name: normalized, exists: false } };
    return {
      ok: true,
      data: {
        name: tag.name,
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
    if (!page) return { ok: true, data: { title: normalized, found: false } };
    return {
      ok: true,
      data: {
        title: page.title,
        found: true,
        otherNames: page.other_names?.slice(0, 8) ?? [],
        body: (page.body || "").slice(0, 900),
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

export const toolSchemas = [
  {
    type: "function" as const,
    function: {
      name: "search_danbooru_tags",
      description:
        "在 Danbooru 检索标签。只接受英文或罗马字关键词；中文概念需先自行翻译或用 web_search 查证后再调用。返回匹配标签及其分类与图片数。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "英文关键词，例如 rain、neon、white hair",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verify_danbooru_tag",
      description:
        "校验某个 Danbooru 标签是否真实存在，返回精确名称、分类与图片数。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "待校验的完整标签名" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_danbooru_wiki",
      description:
        "读取 Danbooru 标签词条说明与别名，用于确认标签含义或找到更规范的同义标签。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "词条标题，通常等于标签名" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "检索网络百科，用于把中文或小众概念转换成通用英文说法，再据此检索 Danbooru 标签。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索词，可为中文" },
        },
        required: ["query"],
      },
    },
  },
];

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const text = (key: string) =>
    typeof args[key] === "string" ? (args[key] as string).slice(0, 200) : "";
  switch (name) {
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
