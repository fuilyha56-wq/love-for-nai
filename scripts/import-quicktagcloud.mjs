import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const DATA_BASE = "https://assets.quicktagcloud.com/data";
const ASSET_BASE = "https://assets.quicktagcloud.com";
const KNOWN_FIELDS = new Set(["id", "title", "path", "rating", "tags", "negative", "characterPrompts", "note", "image",
  "original", "imageWidth", "imageHeight", "images", "updateBatches", "assetRev", "assetCodexId", "isNew"]);

function loadEnvFile(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(DATABASE_URL|NEWAPI_DB_URL)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function assetUrl(codex, entry, file, kind) {
  if (!file) return null;
  if (/^https?:\/\//.test(file)) return file;
  if (codex.assetPathMode === "relative") return `${codex.assetBaseUrl.replace(/\/$/, "")}/${file.replace(/^\//, "")}`;
  const url = `${ASSET_BASE}/${kind === "original" ? "originals" : "images"}/${entry.assetCodexId || codex.id}/${file}`;
  return entry.assetRev ? `${url}?v=${encodeURIComponent(entry.assetRev)}` : url;
}

// 站点未标注评级的条目跟随所属法典：NSFW 法典视为 r18，其余视为 safe。
function normalizeRating(entry, codex) {
  const rating = typeof entry.rating === "string" ? entry.rating.trim().toLowerCase() : "";
  return rating || (codex.nsfw ? "r18" : "safe");
}

async function loadCodex(meta, releaseBase) {
  if (meta.dataUrl) {
    try {
      return { data: await fetchJson(meta.dataUrl), sourceUrl: meta.dataUrl };
    } catch (error) {
      console.warn(`${meta.id} 外部源不可用，改用站点快照：${error.message}`);
    }
  }
  const sourceUrl = `${releaseBase}/${meta.id}.json`;
  return { data: await fetchJson(sourceUrl), sourceUrl };
}

async function importCodex(client, meta, releaseBase) {
  const { data, sourceUrl } = await loadCodex(meta, releaseBase);
  if (!Array.isArray(data.entries)) throw new Error(`${meta.id} 缺少 entries 数组`);
  const codex = { ...meta, ...data, id: meta.id, nsfw: Boolean(meta.nsfw), assetPathMode: meta.assetPathMode, assetBaseUrl: meta.assetBaseUrl };
  const assetBase = codex.assetPathMode === "relative" ? codex.assetBaseUrl : ASSET_BASE;

  await client.query(`
    INSERT INTO quicktagcloud_codexes
      (id, title, selector_title, type, version, author, source, entry_count, nsfw, has_original,
       asset_base_url, tree, contributors, source_url, imported_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
    ON CONFLICT (id) DO UPDATE SET
      title=EXCLUDED.title, selector_title=EXCLUDED.selector_title, type=EXCLUDED.type, version=EXCLUDED.version,
      author=EXCLUDED.author, source=EXCLUDED.source, entry_count=EXCLUDED.entry_count, nsfw=EXCLUDED.nsfw,
      has_original=EXCLUDED.has_original, asset_base_url=EXCLUDED.asset_base_url, tree=EXCLUDED.tree,
      contributors=EXCLUDED.contributors, source_url=EXCLUDED.source_url, imported_at=NOW()
  `, [codex.id, meta.title, meta.selectorTitle || null, meta.type || null, data.version || meta.version || null,
    meta.author || data.author || null, meta.source || null, data.entries.length, codex.nsfw, Boolean(meta.hasOriginal),
    assetBase, JSON.stringify(data.tree || meta.tree || []), JSON.stringify(meta.contributors || []), sourceUrl]);

  await client.query("DELETE FROM quicktagcloud_entries WHERE codex_id = $1", [codex.id]);
  const seen = new Set();
  for (const entry of data.entries) {
    const id = String(entry.id ?? entry.assetId ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !KNOWN_FIELDS.has(key)));
    const images = Array.isArray(entry.images)
      ? entry.images.map((image) => ({ ...image, url: assetUrl(codex, entry, image.path, "image"), originalUrl: assetUrl(codex, entry, image.original, "original") }))
      : null;
    await client.query(`
      INSERT INTO quicktagcloud_entries
        (codex_id, id, title, category_path, rating, tags, negative, character_prompts, note, image_url, original_url,
         image_width, image_height, images, update_batches, extra, imported_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
    `, [codex.id, id, String(entry.title || id), (entry.path || []).map((part) => String(part).trim()),
      normalizeRating(entry, codex), String(entry.tags || ""), entry.negative || null,
      entry.characterPrompts ? JSON.stringify(entry.characterPrompts) : null, entry.note || null,
      assetUrl(codex, entry, entry.image, "image"), assetUrl(codex, entry, entry.original, "original"),
      Number.isFinite(entry.imageWidth) ? entry.imageWidth : null, Number.isFinite(entry.imageHeight) ? entry.imageHeight : null,
      images ? JSON.stringify(images) : null, Array.isArray(entry.updateBatches) ? entry.updateBatches : [],
      Object.keys(extra).length ? JSON.stringify(extra) : null]);
  }
  return { id: codex.id, title: meta.title, imported: seen.size, sourceUrl };
}

async function main() {
  try {
    loadEnvFile(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
  } catch {}
  const connectionString = process.env.DATABASE_URL || process.env.NEWAPI_DB_URL;
  if (!connectionString) throw new Error("请配置 DATABASE_URL 或 NEWAPI_DB_URL");

  const pointer = await fetchJson(`${DATA_BASE}/current.json`);
  const releaseBase = `${DATA_BASE}/releases/${pointer.release}`;
  const catalog = await fetchJson(`${releaseBase}/codexes.json`);
  const only = new Set(process.argv.slice(2));
  const targets = catalog.filter((meta) => !only.size || only.has(meta.id));

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  const results = [];
  try {
    await client.query(await readFile(new URL("../migrations/004_quicktagcloud_codex.sql", import.meta.url), "utf8"));
    for (const meta of targets) {
      await client.query("BEGIN");
      try {
        results.push(await importCodex(client, meta, releaseBase));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        results.push({ id: meta.id, title: meta.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify({ release: pointer.release, codexes: results }, null, 2));
  if (results.some((result) => result.error)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
