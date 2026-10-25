import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dataDir: string;
beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), "lfn-json-cache-")); });
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

describe("server JSON cache", () => {
  it("returns isolated copies and notices atomic file changes", async () => {
    const { readCachedJsonFile } = await import("@/lib/server-json-cache");
    const file = path.join(dataDir, "store.json");
    await writeFile(file, JSON.stringify({ items: ["one"] }));
    const first = await readCachedJsonFile(file, (value) => value as { items: string[] });
    first.items.push("caller mutation");
    expect(await readCachedJsonFile(file, (value) => value as { items: string[] })).toEqual({ items: ["one"] });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(file, JSON.stringify({ items: ["two"] }));
    expect(await readCachedJsonFile(file, (value) => value as { items: string[] })).toEqual({ items: ["two"] });
  });
});
