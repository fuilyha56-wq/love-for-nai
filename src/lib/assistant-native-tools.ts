type Schema = Record<string, unknown>;
const text = { type: "string" };
const texts = (maxItems: number) => ({ type: "array", items: text, maxItems });
const fn = (name: string, description: string, properties: Record<string, Schema>, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

/** The same server tools are available through native function calls and the text compatibility protocol. */
export function assistantNativeTools() {
  return [
    fn("search_tag_catalog", "检索本地完整 Danbooru/QuickTagCloud 标签库；query 与 queries 二选一，多概念用 queries。搜索摘要不等于完整词条。", { query: text, queries: texts(8), source: { type: "string", enum: ["danbooru", "quicktagcloud"] } }),
    fn("read_tag_catalog", "读取已选本地词条的完整介绍和原始内容，key 与 keys 二选一。", { key: text, keys: texts(6) }),
    fn("tag_catalog_status", "查询本地库的来源、版本及完整性。", {}),
    fn("search_danbooru_tags", "实时联网检索 Danbooru 标签，不使用本地缓存代替。", { query: text }, ["query"]),
    fn("verify_danbooru_tag", "实时联网核验精确 Danbooru 标签名。", { name: text }, ["name"]),
    fn("read_danbooru_wiki", "实时联网读取 Danbooru wiki 定义与别名。", { title: text }, ["title"]),
    fn("list_quicktagcloud_codexes", "读取在线 QuickTagCloud 目录和当前发布版本，选择合适 codexId（目录缓存两分钟）。", {}),
    fn("search_quicktagcloud_tags", "在线搜索所选 QuickTagCloud 目录，返回相关候选和 entryId。命中后优先读取完整词条。", { codexId: text, query: text }, ["codexId", "query"]),
    fn("read_quicktagcloud_entry", "读取所选在线 QuickTagCloud 词条的完整原文、组合提示词及来源链接。", { codexId: text, entryId: text }, ["codexId", "entryId"]),
    fn("web_search", "检索 Wikipedia 概念，将中文或罕见概念转为英文检索词。", { query: text }, ["query"]),
  ];
}
