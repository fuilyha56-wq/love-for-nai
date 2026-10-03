import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { DocumentVersionConflictError, publishDocument } from "@/lib/documents";
import { invalidJsonResponse, optionalNumber, parseJsonBody } from "@/lib/request";

export async function POST(
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
  const version = optionalNumber(body.version);
  if (version === undefined || !Number.isInteger(version) || version < 1) {
    return NextResponse.json({ message: "缺少有效的文档版本号" }, { status: 400 });
  }
  try {
    const item = await publishDocument(
      (await params).id,
      version,
      gate.session.displayName || gate.session.username,
    );
    if (!item) return NextResponse.json({ message: "文档不存在" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof DocumentVersionConflictError) {
      return NextResponse.json({ message: error.message, item: error.document }, { status: 409 });
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : "发布文档失败" }, { status: 400 });
  }
}
