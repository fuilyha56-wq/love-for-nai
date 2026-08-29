import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findHistory, historyImagePath } from "@/lib/history";
import { getRemoteHistoryImage } from "@/lib/remote-history";
import { getSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const item = await findHistory(session.userId, (await params).id);
  if (!item) return new NextResponse(null, { status: 404 });
  const extension = item.imagePath.split(".").pop();
  const contentType =
    extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
  };
  // 远程层的图片从二级存储拉取；本地层直接读磁盘。
  if (item.remote) {
    const remote = await getRemoteHistoryImage(
      session.userId,
      item.imagePath,
    );
    if (!remote) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(remote.data), { headers });
  }
  try {
    const data = await readFile(
      historyImagePath(session.userId, item.imagePath),
    );
    return new NextResponse(data, { headers });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
