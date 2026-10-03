import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteDocument, DocumentVersionConflictError, getDocument, updateDocument } from "@/lib/documents";
import { invalidJsonResponse, optionalNumber, optionalString, parseJsonBody } from "@/lib/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const item = await getDocument((await params).id);
  if (!item) return NextResponse.json({ message: "文档不存在" }, { status: 404 });
  return NextResponse.json({ item }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const expectedVersion = optionalNumber(body.version);
  if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ message: "缺少有效的文档版本号" }, { status: 400 });
  }
  try {
    const item = await updateDocument(
      (await params).id,
      {
        ...(optionalString(body.slug) !== undefined ? { slug: optionalString(body.slug) } : {}),
        ...(optionalString(body.title) !== undefined ? { title: optionalString(body.title) } : {}),
        ...(optionalString(body.category) !== undefined ? { category: optionalString(body.category) } : {}),
        ...(optionalString(body.summary) !== undefined ? { summary: optionalString(body.summary) } : {}),
        ...(optionalString(body.content) !== undefined ? { content: optionalString(body.content) } : {}),
        ...(body.status === "draft" || body.status === "published" ? { status: body.status } : {}),
        ...(optionalNumber(body.sortOrder) !== undefined ? { sortOrder: optionalNumber(body.sortOrder) } : {}),
      },
      expectedVersion,
      gate.session.displayName || gate.session.username,
    );
    if (!item) return NextResponse.json({ message: "文档不存在" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof DocumentVersionConflictError) {
      return NextResponse.json({ message: error.message, item: error.document }, { status: 409 });
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : "保存文档失败" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const ok = await deleteDocument((await params).id);
    if (!ok) return NextResponse.json({ message: "文档不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "删除文档失败" }, { status: 400 });
  }
}
