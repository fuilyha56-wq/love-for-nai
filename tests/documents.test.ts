import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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

  it("保留内置文档并允许删除自定义文档", async () => {
    const { BuiltInDocumentError, createDocument, deleteDocument, listDocuments } = await import("@/lib/documents");
    const seeded = (await listDocuments())[0];
    await expect(deleteDocument(seeded.id)).rejects.toBeInstanceOf(BuiltInDocumentError);
    const custom = await createDocument({ slug: "removable", title: "可删", category: "测试", summary: "", content: "内容", status: "draft", sortOrder: 100, updatedBy: "tester" });
    expect(await deleteDocument(custom.id)).toBe(true);
    expect((await listDocuments()).some((item) => item.id === custom.id)).toBe(false);
  });
});
