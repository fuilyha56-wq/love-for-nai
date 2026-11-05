import { getSession } from "@/lib/session";
import { readRiskJson } from "@/lib/risk-http";
import {
  appendTiledSource, createTiledSource, deleteTiledSource, prepareTiledSource, readTiledSourceTile, TiledSourceError,
} from "@/lib/tiled-upscale-source";
import type { TileUpscaleFactor } from "@/lib/image-tile-upscale";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStore });
}

function validMutation(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get("host");
  } catch { return false; }
}

async function withSourceSession(request: Request, action: (userId: number, query: URLSearchParams) => Promise<Response>) {
  const session = await getSession();
  if (!session) return json({ message: "请先登录后上传大图" }, 401);
  if (request.method !== "GET" && !validMutation(request)) return json({ message: "请求来源无效" }, 403);
  try {
    return await action(session.userId, new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof TiledSourceError) return json({ message: error.message }, error.status);
    if (error instanceof RangeError) return json({ message: error.message }, 400);
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOSPC") return json({ message: "源图暂存空间不足" }, 507);
    return json({ message: "暂时无法处理大图源文件，请重试" }, 500);
  }
}

function integerQuery(query: URLSearchParams, key: string) {
  const value = query.get(key);
  if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new TiledSourceError(400, "上传位置、倍率或分块编号无效");
  }
  return Number(value);
}

export async function POST(request: Request) {
  return withSourceSession(request, async (userId, query) => {
    if (query.has("id")) return json(await prepareTiledSource(userId, query.get("id") ?? ""));
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ message: "源图信息必须为 JSON" }, 415);
    }
    const body = await readRiskJson(request, 1024).catch(() => null);
    if (!body) return json({ message: "源图信息无效" }, 400);
    return json(await createTiledSource(userId, body.bytes), 201);
  });
}

export async function PUT(request: Request) {
  return withSourceSession(request, async (userId, query) => json(
    await appendTiledSource(userId, query.get("id") ?? "", integerQuery(query, "offset"), request),
  ));
}

export async function GET(request: Request) {
  return withSourceSession(request, async (userId, query) => {
    const png = await readTiledSourceTile(userId, query.get("id") ?? "", integerQuery(query, "scale") as TileUpscaleFactor,
      integerQuery(query, "index"), request.signal);
    return new Response(new Uint8Array(png), { headers: { ...noStore, "Content-Type": "image/png" } });
  });
}

export async function DELETE(request: Request) {
  return withSourceSession(request, async (userId, query) => {
    await deleteTiledSource(userId, query.get("id") ?? "");
    return new Response(null, { status: 204, headers: noStore });
  });
}
