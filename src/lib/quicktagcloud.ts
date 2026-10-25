import { createHash } from "node:crypto";
import { outboundFetch } from "@/lib/outbound";

const ASSETS = "https://assets.quicktagcloud.com/data";
const MAX_DOCUMENT_BYTES = 26 * 1024 * 1024;
const TTL = 2 * 60_000;
type RecordData = Record<string, unknown>;
type FileInfo = { size: number; sha256: string };
type Index = { release: string; files: Record<string, FileInfo>; codexes: RecordData[]; fetchedAt: number };
let indexCache: Index | undefined;
let indexPending: Promise<Index> | undefined;
// Only retain one selected codex; loading the entire online corpus would be costly.
let documentCache: { key: string; entries: RecordData[] } | undefined;
let documentLock: Promise<unknown> = Promise.resolve();

const record = (value: unknown): RecordData => value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {};
const identifier = (value: string) => /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const sourceUrl = (codexId: string, entryId: string) => `https://novelai.quicktagcloud.com/?${new URLSearchParams({ codex: codexId, entry: entryId })}`;

async function fetchJson(url: string, maximum: number, info?: FileInfo): Promise<unknown> {
  const response = await outboundFetch(url, {
    headers: { "User-Agent": "Love-for-NAI/0.1 (public tag lookup)", Accept: "application/json", Referer: "https://novelai.quicktagcloud.com/" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`QuickTagCloud 在线读取失败（HTTP ${response.status}）`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > maximum) throw new Error("QuickTagCloud 文件超出单次读取上限，请使用本地完整数据库");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("QuickTagCloud 返回空文件");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error("QuickTagCloud 文件超出单次读取上限，请使用本地完整数据库");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (info && (bytes.length !== info.size || createHash("sha256").update(bytes).digest("hex") !== info.sha256))
    throw new Error("QuickTagCloud 文件与发布清单不符，未使用该结果");
  return JSON.parse(bytes.toString("utf8"));
}

async function loadIndex(): Promise<Index> {
  if (indexCache && Date.now() - indexCache.fetchedAt < TTL) return indexCache;
  if (indexPending) return indexPending;
  indexPending = (async () => {
    const pointer = record(await fetchJson(`${ASSETS}/current.json`, 16_384));
    const release = String(pointer.release || "");
    if (!identifier(release)) throw new Error("QuickTagCloud 发布版本无效");
    const base = `${ASSETS}/releases/${release}`;
    const manifest = record(await fetchJson(`${base}/manifest.json`, 1_048_576));
    const files: Record<string, FileInfo> = {};
    for (const [name, value] of Object.entries(record(manifest.files))) {
      const file = record(value);
      if (/^[a-zA-Z0-9_-]+\.json$/.test(name) && Number.isSafeInteger(file.size) && Number(file.size) > 0 && /^[a-f0-9]{64}$/.test(String(file.sha256)))
        files[name] = { size: Number(file.size), sha256: String(file.sha256) };
    }
    if (!files["codexes.json"]) throw new Error("QuickTagCloud 缺少目录清单");
    const data = await fetchJson(`${base}/codexes.json`, 2_097_152, files["codexes.json"]);
    if (!Array.isArray(data)) throw new Error("QuickTagCloud 目录格式无效");
    const codexes = data.map(record).filter((item) => identifier(String(item.id)) && files[`${item.id}.json`]);
    indexCache = { release, files, codexes, fetchedAt: Date.now() };
    return indexCache;
  })();
  try { return await indexPending; }
  finally { indexPending = undefined; }
}

async function loadEntries(index: Index, codexId: string): Promise<RecordData[]> {
  if (!identifier(codexId) || !index.codexes.some((item) => item.id === codexId)) throw new Error("请先列出在线 QuickTagCloud 目录并选择有效的 codexId");
  const key = `${index.release}:${codexId}`;
  const task = documentLock.then(async () => {
    if (documentCache?.key === key) return documentCache.entries;
    const info = index.files[`${codexId}.json`];
    if (info.size > MAX_DOCUMENT_BYTES) throw new Error("该在线目录超出单次读取上限，请检索本地完整数据库");
    documentCache = undefined;
    const data = record(await fetchJson(`${ASSETS}/releases/${index.release}/${codexId}.json`, MAX_DOCUMENT_BYTES, info));
    if (!Array.isArray(data.entries)) throw new Error("QuickTagCloud 词条格式无效");
    const entries = data.entries.map((entry, position) => ({ ...record(entry), id: String(record(entry).id ?? record(entry).assetId ?? position) }));
    documentCache = { key, entries };
    return entries;
  });
  documentLock = task.catch(() => undefined);
  return task;
}

const normalize = (text: string) => text.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();

export async function runQuickTagCloudTool(name: string, args: Record<string, unknown>) {
  const source = "quicktagcloud_online";
  try {
    const index = await loadIndex();
    const provenance = { source, release: index.release, fetchedAt: new Date(index.fetchedAt).toISOString() };
    if (name === "list_quicktagcloud_codexes") return { ok: true, data: { ...provenance, codexes: index.codexes.map(({ id, title, version, entryCount, type }) => ({ id, title, version, entryCount, type })) } };
    const codexId = typeof args.codexId === "string" ? args.codexId : "";
    if (name === "search_quicktagcloud_tags") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query || query.length > 120) throw new Error("在线 QuickTagCloud 查询需要 1–120 字的关键词");
      const entries = await loadEntries(index, codexId);
      const terms = normalize(query).split(/[,，]+/).map((term) => term.trim()).filter(Boolean);
      const matches = entries.map((entry) => {
        const title = normalize(String(entry.title || ""));
        const path = Array.isArray(entry.path) ? entry.path.map(String) : [];
        const prompt = normalize(String(entry.tags || ""));
        const text = normalize([title, ...path, String(entry.note || "")].join(" "));
        const matchedTerms = terms.filter((term) => text.includes(term) || prompt.includes(term));
        const score = matchedTerms.reduce((sum, term) => sum + (title === term ? 10 : title.includes(term) ? 5 : text.includes(term) ? 2 : 1), 0);
        return { entry, path, matchedTerms, score };
      }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
      return { ok: true, data: { ...provenance, codexId, query, total: matches.length, entries: matches.slice(0, 12).map(({ entry, path, matchedTerms }) => ({
        entryId: entry.id, title: entry.title, path, matchedTerms, hasPrompt: Boolean(entry.tags), sourceUrl: sourceUrl(codexId, String(entry.id)),
      })) } };
    }
    if (name !== "read_quicktagcloud_entry") throw new Error("未知 QuickTagCloud 工具");
    const entryId = typeof args.entryId === "string" ? args.entryId : "";
    if (!entryId || entryId.length > 200) throw new Error("需要有效的 entryId");
    const entries = await loadEntries(index, codexId);
    const entry = entries.find((item) => item.id === entryId);
    return { ok: Boolean(entry), data: { ...provenance, codexId, entryId, found: Boolean(entry), ...(entry ? { entry, sourceUrl: sourceUrl(codexId, entryId) } : {}) } };
  } catch (error) {
    return { ok: false, data: { source, message: error instanceof Error ? error.message : "在线 QuickTagCloud 暂不可用" } };
  }
}
