import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "@/lib/agent-tools";
import { closeTagCatalog, readCatalogTag, searchTagCatalog, tagCatalogStatus } from "@/lib/tag-catalog";

let directory: string;
let db: DatabaseSync;
const previous = process.env.LFN_TAG_CATALOG_PATH;
const fullDescription = "A complete source explanation. ".repeat(400);

function insert(key: string, name: string, source = "danbooru", description = fullDescription, count = 0) {
  db.prepare("INSERT INTO catalog_tags(key,source,source_id,name,display_name,category,post_count,deprecated,description,aliases,insertion,source_url,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(key, source, key, name, source === "quicktagcloud" ? "月夜白发" : name.replaceAll("_", " "), source === "quicktagcloud" ? 6 : 0, count, 1, description, "", name, "https://example.test/source", JSON.stringify({ name, rating: "all", zeroCount: count === 0, extra: { untouched: true } }));
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "lfn-tag-catalog-"));
  const file = path.join(directory, "catalog.sqlite3");
  process.env.LFN_TAG_CATALOG_PATH = file;
  db = new DatabaseSync(file);
  db.exec(readFileSync(path.join(process.cwd(), "resources/tag-catalog/schema.sql"), "utf8"));
});
afterEach(() => {
  closeTagCatalog();
  db.close();
  if (previous === undefined) delete process.env.LFN_TAG_CATALOG_PATH;
  else process.env.LFN_TAG_CATALOG_PATH = previous;
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.join(path.resolve(os.tmpdir()), "lfn-tag-catalog-"))) throw new Error("Unexpected test directory");
  rmSync(resolved, { recursive: true, force: true });
});

describe("shared complete tag catalog", () => {
  it("keeps zero-use and deprecated tags and returns their entire source payload", () => {
    insert("danbooru:1", "white_hair");
    const item = readCatalogTag("white_hair");
    expect(item?.description).toBe(fullDescription);
    expect(item?.raw).toEqual({ name: "white_hair", rating: "all", zeroCount: true, extra: { untouched: true } });
    expect(item?.deprecated).toBe(true);
    expect(searchTagCatalog("white")?.[0].name).toBe("white_hair");
  });

  it("mixes matching curated prompts with popular tags without rewriting the insertion", () => {
    for (let index = 0; index < 20; index++) insert(`danbooru:${index}`, `moon_${index}`, "danbooru", "moon", 1000);
    const prompt = "2::moon, white hair::, intricate kimono";
    insert("quicktagcloud:book:1", prompt, "quicktagcloud", "moonlight description");
    const results = searchTagCatalog("moon")!;
    expect(results).toHaveLength(16);
    expect(results.find((item) => item.source === "quicktagcloud")?.insertion).toBe(prompt);
    expect(readCatalogTag("quicktagcloud:book:1")?.raw.extra).toEqual({ untouched: true });
  });

  it("uses complete wiki text and translations for search, with unabridged detail reads", () => {
    insert("danbooru:1", "white_hair", "danbooru", fullDescription + " moonlight scene");
    db.prepare("INSERT INTO catalog_translations VALUES(?,?,?,?)").run("white_hair", "source", "m", "白发");
    db.exec("INSERT INTO catalog_search(catalog_search) VALUES('rebuild')");
    db.prepare("INSERT INTO catalog_sync VALUES(?,?)").run("catalog:status", JSON.stringify({ complete: true, searchIndex: "complete" }));
    expect(searchTagCatalog("白发")?.[0].name).toBe("white_hair");
    expect(searchTagCatalog("moonlight")?.[0].name).toBe("white_hair");
    expect(readCatalogTag("white_hair")?.description).toContain(fullDescription);
    expect(tagCatalogStatus().complete).toBe(true);
  });

  it("distinguishes an absent source definition from a curated prompt context", () => {
    insert("danbooru:1", "unknown_tag", "danbooru", "");
    expect(readCatalogTag("unknown_tag")?.descriptionStatus).toBe("missing");
    expect(readCatalogTag("unknown_tag")?.description).toContain("来源未提供独立介绍");
    insert("quicktagcloud:1", "moon, white_hair", "quicktagcloud", "Complete combination notes");
    db.prepare("INSERT INTO catalog_terms VALUES(?,?)").run("moon", Number(db.prepare("SELECT rowid FROM catalog_tags WHERE key=?").get("quicktagcloud:1")!.rowid));
    expect(readCatalogTag("moon")).toMatchObject({ name: "moon", descriptionStatus: "context", description: "Complete combination notes" });
  });

  it("reports an incomplete source snapshot as incomplete", () => {
    expect(tagCatalogStatus()).toMatchObject({ available: true, complete: false });
  });

  it("finds intact curated combinations by normalized atomic tag prefixes", () => {
    const prompt = "2::white hair::, blue eyes";
    insert("quicktagcloud:1", prompt, "quicktagcloud", "A source combination");
    const row = db.prepare("SELECT rowid FROM catalog_tags WHERE key=?").get("quicktagcloud:1")!;
    db.prepare("INSERT INTO catalog_terms VALUES(?,?)").run("white_hair", Number(row.rowid));
    expect(searchTagCatalog("white_ha")?.[0]).toMatchObject({ source: "quicktagcloud", insertion: prompt });
    expect(searchTagCatalog("white_ha", 10, "quicktagcloud")?.[0].insertion).toBe(prompt);
  });

  it("finds individual catalog tags inside a combined assistant query", () => {
    for (const name of ["kimono", "red_hair", "white_eyes", "night", "rain", "lantern", "white_hair", "red_eyes"])
      insert(`danbooru:${name}`, name);
    const combined = searchTagCatalog("kimono red_hair white_eyes night rain lantern");
    expect(combined?.map((item) => item.name)).toEqual(expect.arrayContaining(["kimono", "red_hair", "white_eyes", "night", "rain", "lantern"]));
    const phrases = searchTagCatalog("white hair red eyes");
    expect(phrases?.map((item) => item.name)).toEqual(expect.arrayContaining(["white_hair", "red_eyes"]));
  });

  it("lets the assistant batch-search concepts and read complete entries in one tool call", async () => {
    insert("danbooru:white_hair", "white_hair");
    insert("danbooru:red_eyes", "red_eyes", "danbooru", "A source definition for red eyes.");

    const search = await runTool("search_tag_catalog", {
      queries: ["white hair", "red eyes", "white hair"],
    });
    expect(search.ok).toBe(true);
    expect(search.data).toMatchObject({
      queries: [
        { query: "white hair", tags: [expect.objectContaining({ name: "white_hair" })] },
        { query: "red eyes", tags: [expect.objectContaining({ name: "red_eyes" })] },
      ],
    });

    const read = await runTool("read_tag_catalog", {
      keys: ["white_hair", "red_eyes", "not_a_tag"],
    });
    expect(read.ok).toBe(true);
    expect(read.data).toMatchObject({
      tags: [
        expect.objectContaining({ name: "white_hair", descriptionStatus: "source" }),
        expect.objectContaining({ name: "red_eyes", description: "A source definition for red eyes." }),
      ],
      missing: ["not_a_tag"],
    });
  });

  it("keeps unrelated full combinations out of assistant search context without removing source data", async () => {
    insert("danbooru:moon", "moon", "danbooru", "The Moon.", 300);
    for (let index = 0; index < 10; index++) insert(`danbooru:moon_${index}`, `moon_${index}`, "danbooru", "A moon variant.", 1000);
    const prompt = "moon, unrelated_combination, many_unrequested_details";
    insert("quicktagcloud:book:1", prompt, "quicktagcloud", "moon composition");
    const row = db.prepare("SELECT rowid FROM catalog_tags WHERE key=?").get("quicktagcloud:book:1")!;
    db.prepare("INSERT INTO catalog_terms VALUES(?,?)").run("moon", Number(row.rowid));

    const precise = await runTool("search_tag_catalog", { query: "moon" });
    expect(precise.data).toMatchObject({ source: "local_catalog", tags: expect.arrayContaining([expect.objectContaining({ name: "moon", source: "danbooru" })]) });
    expect(JSON.stringify(precise.data)).not.toContain("unrelated_combination");
    const curated = await runTool("search_tag_catalog", { query: "moon", source: "quicktagcloud" });
    expect(curated.data).toMatchObject({ catalogSource: "quicktagcloud", tags: [expect.objectContaining({ catalogKey: "quicktagcloud:book:1", hasPrompt: true })] });
    expect(JSON.stringify(curated.data)).not.toContain("unrelated_combination");
    const full = await runTool("read_tag_catalog", { key: "quicktagcloud:book:1" });
    expect(full.data).toMatchObject({ insertion: prompt, raw: expect.objectContaining({ name: prompt }) });
  });
});
