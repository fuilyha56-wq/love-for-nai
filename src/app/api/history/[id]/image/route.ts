import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findHistory, historyImagePath } from "@/lib/history";
import { getRemoteHistoryImage } from "@/lib/remote-history";
import { getSession } from "@/lib/session";
import { createImageThumbnail } from "@/lib/image-processing";

export async function GET(
  request: Request,
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
  const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
  const send = async (data: Buffer) => {
    if (!thumbnail) return new NextResponse(new Uint8Array(data), { headers });
    const resized = await createImageThumbnail(data);
    return new NextResponse(new Uint8Array(resized), { headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400",
      "Vary": "Cookie",
    } });
  };
  // 远程层的图片从二级存储拉取；本地层直接读磁盘。
  if (item.remote) {
    const remote = await getRemoteHistoryImage(
      session.userId,
      item.imagePath,
    );
    if (!remote) return new NextResponse(null, { status: 404 });
    try { return await send(remote.data); } catch { return new NextResponse(null, { status: 415 }); }
  }
  try {
    const data = await readFile(
      historyImagePath(session.userId, item.imagePath),
    );
    return await send(data);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
