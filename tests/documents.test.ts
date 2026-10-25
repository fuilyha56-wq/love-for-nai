import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-docs-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("文档 CMS", () => {
  it("首次读取播种至少四篇公开 Markdown 文档", async () => {
    const { listDocuments } = await import("@/lib/documents");
    const items = await listDocuments({ publishedOnly: true });
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.every((item) => item.status === "published" && item.content.length > 0)).toBe(true);
    expect(items.map((item) => item.slug)).toEqual(expect.arrayContaining([
      "platform-configuration",
      "gallery-discovery",
      "creator-activities",
      "gallery-tutorial",
    ]));
    expect(items.find((item) => item.slug === "gallery-tutorial")?.content).toContain("/docs/gallery-workflow.svg");
  });

  it("更新使用版本乐观锁，发布会递增版本", async () => {
    const { DocumentVersionConflictError, createDocument, publishDocument, updateDocument } = await import("@/lib/documents");
    const created = await createDocument({
      slug: "test-doc",
      title: "测试文档",
      category: "测试",
      summary: "摘要",
      content: "# 初稿",
      status: "draft",
      sortOrder: 99,
      updatedBy: "tester",
    });
    const updated = await updateDocument(created.id, { content: "# 新稿" }, created.version, "tester");
    expect(updated?.version).toBe(2);
    await expect(updateDocument(created.id, { title: "过期修改" }, created.version, "other")).rejects.toBeInstanceOf(DocumentVersionConflictError);
    const published = await publishDocument(created.id, updated!.version, "tester");
    expect(published).toMatchObject({ status: "published", version: 3 });
  });

  it("升级旧内置教程前备份，保留管理员编辑与自定义文档", async () => {
    const { listDocuments } = await import("@/lib/documents");
    const { currentDocumentation, DOCUMENTATION_REVISION } = await import("@/lib/documentation-content");
    const baseline = await listDocuments();
    const original = baseline.find((item) => item.slug === "api-overview")!;
    const edited = baseline.find((item) => item.slug === "quickstart")!;
    const old = { ...original, content: "旧的内置正文", title: "旧标题", builtInRevision: 20261024, version: 3 };
    const manual = { ...edited, content: "管理员自己的教程", updatedBy: "admin", builtInRevision: 20261024 };
    const custom = { ...edited, id: "custom-guide", slug: "custom-guide", title: "自定义文档", content: "自定义内容", builtIn: false, updatedBy: "admin" };
    const directory = path.join(dataDir, "documents");
    await mkdir(directory, { recursive: true });
    const previous = JSON.stringify({ items: [old, manual, custom] });
    await writeFile(path.join(directory, "index.json"), previous);

    const migrated = await listDocuments();
    expect(migrated.find((item) => item.id === old.id)).toMatchObject({ content: currentDocumentation[old.slug], builtInRevision: DOCUMENTATION_REVISION, version: 4, title: "API 接入总览与端点速查" });
    expect(migrated.find((item) => item.id === manual.id)).toEqual(manual);
    expect(migrated.find((item) => item.id === custom.id)).toEqual(custom);
    const backups = (await readdir(directory)).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(directory, backups[0]), "utf8")).toBe(previous);
    await listDocuments();
    expect((await readdir(directory)).filter((name) => name.endsWith(".bak"))).toHaveLength(1);
  });

  it("保留内置文档并允许删除自定义文档", async () => {
    const { BuiltInDocumentError, createDocument, deleteDocument, listDocuments } = await import("@/lib/documents");
    const seeded = (await listDocuments())[0];
    await expect(deleteDocument(seeded.id)).rejects.toBeInstanceOf(BuiltInDocumentError);
    const custom = await createDocument({ slug: "removable", title: "可删", category: "测试", summary: "", content: "内容", status: "draft", sortOrder: 100, updatedBy: "tester" });
    expect(await deleteDocument(custom.id)).toBe(true);
    expect((await listDocuments()).some((item) => item.id === custom.id)).toBe(false);
  });
});
