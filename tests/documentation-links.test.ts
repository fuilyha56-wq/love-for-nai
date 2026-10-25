import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentationGuides } from "@/lib/documentation-content";

describe("published user-guide resources", () => {
  it("resolves article links and local illustrations/downloads", async () => {
    const slugs = new Set(documentationGuides.map((guide) => guide.slug));
    const assets = new Set<string>();
    expect(slugs.size).toBe(19);
    for (const guide of documentationGuides) {
      expect(guide.content.match(/^```/gm)?.length ?? 0, guide.slug).toSatisfy((count: number) => count % 2 === 0);
      for (const match of guide.content.matchAll(/\]\((\/docs[^)]*)\)/g)) {
        if (match[1].startsWith("/docs?slug=")) expect(slugs.has(new URL(match[1], "https://lfn.example").searchParams.get("slug") || ""), `${guide.slug}: ${match[1]}`).toBe(true);
        else if (match[1].startsWith("/docs/")) assets.add(match[1]);
      }
    }
    for (const asset of assets) await access(path.join(process.cwd(), "public", asset));
  });

  it("ships a usable request collection with empty credentials and valid JSON bodies", async () => {
    const collection = JSON.parse(await readFile("public/docs/lfn-api.postman_collection.json", "utf8"));
    expect(collection.variable.find((variable: { key: string }) => variable.key === "api_key").value).toBe("");
    expect(collection.auth.type).toBe("bearer");
    for (const item of collection.item) {
      expect(item.request.url).toMatch(/^\{\{base_url\}\}\//);
      if (item.request.body?.raw) expect(JSON.parse(item.request.body.raw)).toHaveProperty("model");
    }
  });
});
