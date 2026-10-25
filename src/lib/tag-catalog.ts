import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tagZh } from "@/lib/tag-translations";

const categories: Record<number, string> = { 0: "通用", 1: "画师", 3: "作品", 4: "角色", 5: "元数据", 6: "QuickTagCloud" };
const runtime = globalThis as typeof globalThis & { __lfnTagCatalog?: { file: string; identity: string; db: DatabaseSync } };
type Row = Record<string, unknown>;
const likeText = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export function catalogDatabasePath(): string {
  return process.env.LFN_TAG_CATALOG_PATH || path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "tag-catalog/catalog.sqlite3");
}

function database(): DatabaseSync | null {
  const file = catalogDatabasePath();
  let identity: string;
  // The catalog is supplied as runtime data, independently of the app bundle.
  try { const info = statSync(/* turbopackIgnore: true */ file); identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`; }
  catch { return null; }
  if (runtime.__lfnTagCatalog?.file !== file || runtime.__lfnTagCatalog.identity !== identity) {
    runtime.__lfnTagCatalog?.db.close();
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=1500; PRAGMA cache_size=-8192;");
    runtime.__lfnTagCatalog = { file, identity, db };
  }
  return runtime.__lfnTagCatalog.db;
}

export function closeTagCatalog() {
  runtime.__lfnTagCatalog?.db.close();
  delete runtime.__lfnTagCatalog;
}

function state(db: DatabaseSync, key: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT state_json FROM catalog_sync WHERE key=?").get(key);
  return row ? JSON.parse(String(row.state_json)) : null;
}

export function tagCatalogStatus() {
  const db = database();
  if (!db) return { available: false, complete: false };
  return { available: true, complete: false, ...state(db, "catalog:status"), sources: { danbooru: state(db, "danbooru:snapshot"), quicktagcloud: state(db, "quicktagcloud:snapshot") } };
}

function hit(row: Row) {
  const name = String(row.name);
  const description = String(row.description || "");
  const category = Number(row.category);
  let zh = tagZh(name);
  try {
    const translation = database()?.prepare("SELECT value FROM catalog_translations WHERE term=? ORDER BY CASE kind WHEN 'm' THEN 0 WHEN 'd' THEN 1 ELSE 2 END LIMIT 1").get(name.toLowerCase().replaceAll(" ", "_"));
    if (translation) zh = String(translation.value);
  } catch { /* a resumable older snapshot may not have its translation index yet */ }
  return {
    name, displayName: String(row.display_name), category, categoryName: categories[category] || "其他",
    postCount: Number(row.post_count), source: String(row.source), catalogKey: String(row.key),
    insertion: String(row.insertion || name), zh,
    description: description.slice(0, 280), hasDescription: Boolean(description),
    descriptionUrl: `/api/tags?key=${encodeURIComponent(String(row.key))}`,
    deprecated: Boolean(row.deprecated),
  };
}

export function searchTagCatalog(query: string, limit = 16, source?: string) {
  const db = database();
  if (!db) return null;
  const count = Math.min(100, Math.max(1, Math.floor(limit)));
  const direct = searchCatalogQuery(db, query, count, source);
  if (direct.length) return direct;

  // Assistant queries may contain several tags at once. Search adjacent tag
  // phrases and then individual tags so a combined request still finds records.
  const parts = query.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 24) return direct;
  const matches = new Map(direct.map((item) => [item.catalogKey, item]));
  for (const width of [2, 1]) {
    for (let index = 0; index + width <= parts.length && matches.size < count; index++) {
      const candidate = parts.slice(index, index + width).join(" ");
      const results = searchCatalogQuery(db, candidate, Math.min(4, count), source);
      for (const item of results) matches.set(item.catalogKey, item);
    }
  }
  return [...matches.values()].slice(0, count);
}

function searchCatalogQuery(db: DatabaseSync, query: string, count: number, source?: string) {
  const normalized = query.trim().toLowerCase().replaceAll(" ", "_");
  if (!normalized) return [];
  const select = "t.key,t.name,t.display_name,t.category,t.post_count,t.source,t.insertion,substr(t.description,1,280) AS description,t.deprecated";
  const sourceClause = source ? " AND t.source=?" : "";
  const sourceArgs = source ? [source] : [];
  // Prefix lookup remains usable during a resumable import, before FTS is built.
  const prefix = db.prepare(`SELECT ${select} FROM catalog_tags t WHERE t.name LIKE ? ESCAPE '\\'${sourceClause} ORDER BY CASE WHEN t.name=? THEN 0 ELSE 1 END,t.post_count DESC,t.key LIMIT ?`).all(likeText(normalized) + "%", ...sourceArgs, normalized, count);
  const found = new Map(prefix.map((row) => [String(row.key), row]));
  if (/[\u3400-\u9fff]/.test(query)) {
    try {
      const translated = db.prepare(`SELECT DISTINCT ${select} FROM catalog_translations tr JOIN catalog_tags t ON t.name=tr.term COLLATE NOCASE WHERE tr.value LIKE ? ESCAPE '\\'${sourceClause} ORDER BY t.post_count DESC LIMIT ?`).all("%" + likeText(query.trim()) + "%", ...sourceArgs, count);
      translated.forEach((row) => found.set(String(row.key), row));
    } catch { /* the source import can still be running */ }
  }
  if (found.size < count && normalized.length >= 3 && state(db, "catalog:status")?.searchIndex === "complete") {
    const phrase = '"' + query.trim().replaceAll('"', '""') + '"';
    // Bound work per suggestion request; the complete corpus remains indexed.
    const rows = db.prepare(`SELECT ${select} FROM catalog_tags t WHERE t.rowid IN (SELECT rowid FROM catalog_search WHERE catalog_search MATCH ? LIMIT ?)${sourceClause} ORDER BY t.post_count DESC,t.key LIMIT ?`).all(phrase, Math.min(2000, count * 20), ...sourceArgs, count);
    rows.forEach((row) => found.set(String(row.key), row));
  } else if (source === "quicktagcloud") {
    const rows = db.prepare(`SELECT ${select} FROM catalog_tags t WHERE t.source='quicktagcloud' AND (t.display_name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\') LIMIT ?`).all("%" + likeText(query.trim()) + "%", "%" + likeText(query.trim()) + "%", count);
    rows.forEach((row) => found.set(String(row.key), row));
  }
  const values = [...found.values()];
  if (!source || source === "quicktagcloud") {
    const pattern = "%" + likeText(query.trim()) + "%";
    const curatedLimit = source ? count : Math.min(4, count);
    const curatedMatches = new Map<string, Row>();
    try {
      const terms = db.prepare(`SELECT ${select} FROM catalog_tags t WHERE t.source='quicktagcloud' AND t.rowid IN (SELECT tag_rowid FROM catalog_terms WHERE term>=? AND term<? LIMIT 200) LIMIT ?`).all(normalized, normalized + "\uffff", curatedLimit);
      terms.forEach((row) => curatedMatches.set(String(row.key), row));
    } catch { /* the derived prompt-term index may still be building */ }
    const direct = db.prepare(`SELECT ${select} FROM catalog_tags t WHERE t.source='quicktagcloud' AND (t.display_name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\') LIMIT ?`).all(pattern, pattern, pattern, curatedLimit);
    direct.forEach((row) => curatedMatches.set(String(row.key), row));
    const curated = [...curatedMatches.values()].slice(0, curatedLimit);
    if (source) return [...curated, ...values.filter((row) => !curatedMatches.has(String(row.key)))].slice(0, count).map(hit);
    const others = values.filter((row) => row.source !== "quicktagcloud");
    const mixed = [...others.slice(0, count - curated.length), ...curated];
    if (mixed.length) return mixed.slice(0, count).map(hit);
  }
  return values.slice(0, count).map(hit);
}

export function readCatalogTag(keyOrName: string) {
  const db = database();
  if (!db) return null;
  const normalized = keyOrName.trim().toLowerCase().replaceAll(" ", "_");
  let row = db.prepare("SELECT * FROM catalog_tags WHERE key=? OR name=? COLLATE NOCASE ORDER BY CASE source WHEN 'danbooru' THEN 0 ELSE 1 END LIMIT 1").get(keyOrName, normalized);
  let contextTerm = "";
  if (!row) {
    try {
      row = db.prepare("SELECT t.* FROM catalog_terms term JOIN catalog_tags t ON t.rowid=term.tag_rowid WHERE term.term=? LIMIT 1").get(normalized);
      if (row) contextTerm = normalized;
    } catch { /* no term index until the initial import has completed */ }
  }
  if (!row) return null;
  const wikis = row.source === "danbooru" ? db.prepare("SELECT raw_json FROM catalog_wikis WHERE title=? ORDER BY is_deleted,id DESC").all(String(row.name)).map((item) => JSON.parse(String(item.raw_json))) : [];
  const description = String(row.description || "");
  return {
    ...hit(row), ...(contextTerm ? { name: contextTerm, displayName: contextTerm.replaceAll("_", " "), insertion: contextTerm } : {}),
    description: description || `来源未提供独立介绍。标签：${contextTerm || row.name}；分类：${categories[Number(row.category)] || "其他"}；来源：${row.source}；图片使用次数：${row.post_count}。`,
    descriptionStatus: contextTerm ? "context" as const : description ? "source" as const : "missing" as const,
    sourceUrl: String(row.source_url), raw: JSON.parse(String(row.raw_json)), wikis,
  };
}
