import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createDocument, listDocuments } from "@/lib/documents";
import { invalidJsonResponse, optionalNumber, optionalString, parseJsonBody } from "@/lib/request";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json({ items: await listDocuments() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const slug = optionalString(body.slug)?.trim() || "";
  const title = optionalString(body.title)?.trim() || "";
  const content = optionalString(body.content) ?? "# 新文档\n\n开始编辑……";
  if (!slug || !title) return NextResponse.json({ message: "slug 和标题不能为空" }, { status: 400 });
  try {
    const item = await createDocument({
      slug,
      title,
      category: optionalString(body.category)?.trim() || "未分类",
      summary: optionalString(body.summary)?.trim() || "",
      content,
      status: "draft",
      sortOrder: optionalNumber(body.sortOrder) ?? 100,
      updatedBy: gate.session.displayName || gate.session.username,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "创建文档失败" }, { status: 400 });
  }
}
