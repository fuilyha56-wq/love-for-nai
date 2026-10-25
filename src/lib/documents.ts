import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  documentationGuides,
  DOCUMENTATION_REVISION,
} from "./documentation-content";

export type DocumentStatus = "draft" | "published";

export type Document = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  status: DocumentStatus;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** Seeded documents are kept as stable built-in content and cannot be deleted. */
  builtIn?: boolean;
  builtInRevision?: number;
};

type Store = { items: Document[]; removedIds?: string[] };

const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "documents",
  );
const storePath = () => path.join(root(), "index.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<Store> {
  try {
    const value = JSON.parse(
      await readFile(storePath(), "utf8"),
    ) as Partial<Store>;
    const items = Array.isArray(value.items)
      ? value.items.filter(isDocument)
      : [];
    return {
      items,
      removedIds: Array.isArray(value.removedIds)
        ? value.removedIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { items: [] };
  }
}

function isDocument(value: unknown): value is Document {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Document>;
  return (
    typeof item.id === "string" &&
    typeof item.slug === "string" &&
    typeof item.title === "string" &&
    typeof item.category === "string" &&
    typeof item.summary === "string" &&
    typeof item.content === "string" &&
    (item.status === "draft" || item.status === "published") &&
    typeof item.sortOrder === "number" &&
    typeof item.version === "number" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.updatedBy === "string"
  );
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

const SEEDED_DOCUMENTS: Document[] = documentationGuides.map((guide) => ({
  ...guide,
  status: "published",
  version: 1,
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  updatedBy: "LFN",
  builtIn: true,
}));

export class DocumentVersionConflictError extends Error {
  constructor(public readonly document: Document) {
    super("文档版本已更新，请刷新后重试");
    this.name = "DocumentVersionConflictError";
  }
}

export class BuiltInDocumentError extends Error {
  constructor() {
    super("内置文档不能删除");
    this.name = "BuiltInDocumentError";
  }
}

export async function ensureSeed(): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const removed = new Set(store.removedIds || []);
    let changed = false;
    let backedUp = false;
    for (const seed of SEEDED_DOCUMENTS) {
      const content = seed.content;
      const existing = store.items.find((item) => item.id === seed.id);
      if (existing) {
        if (
          existing.updatedBy === "LFN" &&
          (existing.builtInRevision || 0) < DOCUMENTATION_REVISION
        ) {
          if (!backedUp) {
            await copyFile(
              storePath(),
              `${storePath()}.before-${DOCUMENTATION_REVISION}-${Date.now()}.bak`,
            );
            backedUp = true;
          }
          Object.assign(existing, {
            title: seed.title,
            category: seed.category,
            summary: seed.summary,
            sortOrder: seed.sortOrder,
            builtIn: true,
            content,
            builtInRevision: DOCUMENTATION_REVISION,
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          });
          changed = true;
        }
        continue;
      }
      if (removed.has(seed.id)) continue;
      store.items.push({
        ...seed,
        content,
        builtInRevision: DOCUMENTATION_REVISION,
      });
      changed = true;
    }
    if (changed) await writeStore(store);
  });
}

function sortDocuments(items: Document[]): Document[] {
  return [...items].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function listDocuments(
  options: { publishedOnly?: boolean } = {},
): Promise<Document[]> {
  await ensureSeed();
  const store = await readStore();
  return sortDocuments(
    options.publishedOnly
      ? store.items.filter((item) => item.status === "published")
      : store.items,
  );
}

export async function getDocumentBySlug(
  slug: string,
  options: { publishedOnly?: boolean } = {},
): Promise<Document | null> {
  await ensureSeed();
  const store = await readStore();
  const item = store.items.find((candidate) => candidate.slug === slug);
  if (!item || (options.publishedOnly && item.status !== "published"))
    return null;
  return item;
}

export async function getDocument(id: string): Promise<Document | null> {
  await ensureSeed();
  const store = await readStore();
  return store.items.find((item) => item.id === id) ?? null;
}

export type CreateDocumentInput = Omit<
  Document,
  "id" | "createdAt" | "updatedAt" | "version" | "builtIn"
> & { builtIn?: boolean };
export type UpdateDocumentInput = Partial<
  Pick<
    Document,
    | "slug"
    | "title"
    | "category"
    | "summary"
    | "content"
    | "sortOrder"
    | "status"
  >
>;

function assertSlug(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error("slug 只能包含小写字母、数字和连字符");
  return value;
}

function assertDocumentFields(input: {
  slug?: string;
  title?: string;
  content?: string;
}) {
  if (input.slug !== undefined) assertSlug(input.slug);
  if (input.title !== undefined && !input.title.trim())
    throw new Error("文档标题不能为空");
  if (input.content !== undefined && !input.content.trim())
    throw new Error("文档内容不能为空");
}

export async function createDocument(
  input: CreateDocumentInput,
): Promise<Document> {
  return withLock(async () => {
    assertDocumentFields(input);
    const slug = assertSlug(input.slug);
    const store = await readStore();
    if (store.items.some((item) => item.slug === slug))
      throw new Error("slug 已存在");
    const now = new Date().toISOString();
    const item: Document = {
      ...input,
      slug,
      title: input.title.trim(),
      summary: input.summary.trim(),
      content: input.content,
      id: randomUUID(),
      status: input.status || "draft",
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: input.updatedBy.trim() || "admin",
      builtIn: false,
    };
    store.items.push(item);
    await writeStore(store);
    return item;
  });
}

export async function updateDocument(
  id: string,
  patch: UpdateDocumentInput,
  expectedVersion?: number,
  updatedBy = "admin",
): Promise<Document | null> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = store.items[index];
    if (expectedVersion !== undefined && current.version !== expectedVersion)
      throw new DocumentVersionConflictError(current);
    assertDocumentFields(patch);
    const nextSlug =
      patch.slug === undefined ? current.slug : assertSlug(patch.slug);
    if (
      nextSlug !== current.slug &&
      store.items.some(
        (item, itemIndex) => itemIndex !== index && item.slug === nextSlug,
      )
    )
      throw new Error("slug 已存在");
    const next: Document = {
      ...current,
      ...patch,
      slug: nextSlug,
      title: patch.title === undefined ? current.title : patch.title.trim(),
      category:
        patch.category === undefined ? current.category : patch.category.trim(),
      summary:
        patch.summary === undefined ? current.summary : patch.summary.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy.trim() || "admin",
      version: current.version + 1,
    };
    store.items[index] = next;
    await writeStore(store);
    return next;
  });
}

export async function publishDocument(
  id: string,
  expectedVersion?: number,
  updatedBy = "admin",
): Promise<Document | null> {
  return updateDocument(
    id,
    { status: "published" },
    expectedVersion,
    updatedBy,
  );
}

export async function deleteDocument(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    if (store.items[index].builtIn) throw new BuiltInDocumentError();
    store.items.splice(index, 1);
    store.removedIds = Array.from(new Set([...(store.removedIds || []), id]));
    await writeStore(store);
    return true;
  });
}

export function publicDocument(item: Document) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    category: item.category,
    summary: item.summary,
    content: item.content,
    status: item.status,
    sortOrder: item.sortOrder,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  };
}
