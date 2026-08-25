import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findHistory, historyImagePath } from "@/lib/history";
import { getSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const item = await findHistory(session.userId, (await params).id);
  if (!item) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(
      historyImagePath(session.userId, item.imagePath),
    );
    const extension = item.imagePath.split(".").pop();
    const contentType =
      extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
