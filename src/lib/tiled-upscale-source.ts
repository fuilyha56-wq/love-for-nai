import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir, open, readFile, readdir, rename, rm, stat, statfs, unlink, utimes, writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describeImageTileUpscale, imageUpscaleTileAt, type TileUpscaleFactor } from "./image-tile-upscale";

export const TILED_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
const MIB = 1024 * 1024;
const ACCOUNT_BYTES = 6 * 1024 * MIB;
const RESERVED_DISK_BYTES = 512 * MIB;
const SOURCE_TTL = 24 * 60 * 60 * 1_000;
const MAX_ACCOUNT_SOURCES = 16;
const TIFF_TILE_EDGE = 256;
const SOURCE_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

type SourceManifest = { bytes: number; prepared?: { width: number; height: number; bytes: number } };

export class TiledSourceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const writes = new Set<string>();
const readers = new Map<string, number>();
let conversionActive = false;
let conversionDiskReservation = 0;
let cropSlotsUsed = 0;
const cropWaiters: Array<() => void> = [];
let sweepAfter = 0;

function sourceRoot() {
  return path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "tiled-upscale-sources");
}

function ownerDirectory(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new TiledSourceError(401, "请先登录");
  return path.join(sourceRoot(), String(userId));
}

function jobDirectory(userId: number, id: string) {
  if (!SOURCE_ID.test(id)) throw new TiledSourceError(400, "源图编号无效");
  return path.join(ownerDirectory(userId), id);
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function readManifest(directory: string): Promise<SourceManifest> {
  try {
    if (Date.now() - (await stat(directory)).mtimeMs >= SOURCE_TTL) {
      throw new TiledSourceError(404, "源图暂存已过期，请重新上传");
    }
    return JSON.parse(await readFile(path.join(directory, "source.json"), "utf8")) as SourceManifest;
  } catch (error) {
    if (isMissing(error)) throw new TiledSourceError(404, "找不到源图或临时文件已过期，请重新上传");
    throw error;
  }
}

async function writeManifest(directory: string, manifest: SourceManifest) {
  const next = path.join(directory, "source.json.tmp");
  await writeFile(next, JSON.stringify(manifest), { mode: 0o600 });
  await rename(next, path.join(directory, "source.json"));
}

async function removeSourceDirectory(directory: string) {
  const owner = path.dirname(directory);
  if (path.dirname(owner) !== sourceRoot() || !/^\d+$/.test(path.basename(owner)) || !SOURCE_ID.test(path.basename(directory))) {
    throw new Error("Invalid source directory");
  }
  await rm(directory, { force: true, recursive: true });
}

async function sweepExpiredSources() {
  const now = Date.now();
  if (now < sweepAfter) return;
  sweepAfter = now + 15 * 60 * 1_000;
  const root = sourceRoot();
  const owners = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const owner of owners) {
    if (!owner.isDirectory() || !/^\d+$/.test(owner.name)) continue;
    const ownerPath = path.join(root, owner.name);
    const jobs = await readdir(ownerPath, { withFileTypes: true }).catch(() => []);
    for (const job of jobs) {
      if (!job.isDirectory() || !SOURCE_ID.test(job.name)) continue;
      const directory = path.join(ownerPath, job.name);
      if (writes.has(directory) || readers.has(directory)) continue;
      const updated = (await stat(directory).catch(() => undefined))?.mtimeMs;
      if (updated === undefined || now - updated < SOURCE_TTL || writes.has(directory) || readers.has(directory)) continue;
      writes.add(directory);
      try { await removeSourceDirectory(directory).catch(() => undefined); }
      finally { writes.delete(directory); }
    }
  }
}

async function withWrite<T>(directory: string, action: () => Promise<T>): Promise<T> {
  if (writes.has(directory) || readers.has(directory)) throw new TiledSourceError(409, "源图正在处理，请稍后重试");
  writes.add(directory);
  try { return await action(); }
  finally { writes.delete(directory); }
}

async function touch(directory: string) {
  const now = new Date();
  await utimes(directory, now, now);
}

async function diskCheck(directory: string, bytes: number) {
  const space = await statfs(directory);
  if (space.bavail * space.bsize - RESERVED_DISK_BYTES - conversionDiskReservation < bytes) {
    throw new TiledSourceError(507, "暂存空间不足，请清理旧源图或稍后重试");
  }
}

async function accountUsage(owner: string, excluding?: string) {
  const jobs = await readdir(owner, { withFileTypes: true });
  let count = 0;
  let bytes = 0;
  for (const job of jobs) {
    if (!job.isDirectory() || !SOURCE_ID.test(job.name)) continue;
    const directory = path.join(owner, job.name);
    if (directory === excluding) continue;
    const manifest = await readManifest(directory).catch(() => null);
    if (!manifest) continue;
    count++;
    bytes += manifest.prepared?.bytes ?? manifest.bytes;
  }
  return { count, bytes };
}

export async function createTiledSource(userId: number, bytes: unknown) {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) throw new TiledSourceError(400, "源图文件大小无效");
  const owner = ownerDirectory(userId);
  await mkdir(owner, { recursive: true, mode: 0o700 });
  await sweepExpiredSources();
  return withWrite(owner, async () => {
    const usage = await accountUsage(owner);
    if (usage.count >= MAX_ACCOUNT_SOURCES) throw new TiledSourceError(429, "账号已暂存 16 张大图，请先继续已有任务。未使用的源图会在 24 小时后清理");
    if (usage.bytes + bytes > ACCOUNT_BYTES) throw new TiledSourceError(413, "源图超过账号剩余的暂存空间。可改用更小的源图，或等待旧源图自动清理");
    await diskCheck(owner, bytes);
    const id = randomUUID();
    const directory = jobDirectory(userId, id);
    await mkdir(directory, { mode: 0o700 });
    try {
      await writeFile(path.join(directory, "upload.bin"), "", { flag: "wx", mode: 0o600 });
      await writeManifest(directory, { bytes });
      return { id };
    } catch (error) {
      await removeSourceDirectory(directory).catch(() => undefined);
      throw error;
    }
  });
}

export async function appendTiledSource(userId: number, id: string, offset: number, request: Request) {
  const directory = jobDirectory(userId, id);
  return withWrite(directory, async () => {
    const manifest = await readManifest(directory);
    if (manifest.prepared) throw new TiledSourceError(409, "源图已准备好，无需继续上传");
    const file = await open(path.join(directory, "upload.bin"), "r+");
    try {
      if (offset !== (await file.stat()).size) throw new TiledSourceError(409, "源图上传位置已变化，请重新上传");
      const limit = Math.min(TILED_SOURCE_CHUNK_BYTES, manifest.bytes - offset);
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        throw new TiledSourceError(413, "上传分段超过允许大小");
      }
      await diskCheck(directory, limit);
      const reader = request.body?.getReader();
      if (!reader) throw new TiledSourceError(400, "上传分段为空");
      let written = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (written + value.length > limit) throw new TiledSourceError(413, "上传分段超过允许大小");
          for (let position = 0; position < value.length;) {
            const { bytesWritten } = await file.write(value, position, value.length - position, offset + written + position);
            if (bytesWritten <= 0) throw new Error("Unable to write image upload");
            position += bytesWritten;
          }
          written += value.length;
        }
        if (!written || (declared !== null && written !== Number(declared))) throw new TiledSourceError(400, "上传分段不完整");
        await touch(directory);
        return { offset: offset + written };
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        await file.truncate(offset);
        throw error;
      } finally { reader.releaseLock(); }
    } finally { await file.close(); }
  });
}

// Native file output processes the source without materializing a raw image in
// JavaScript. The worker owns its libvips cache and uses one CPU thread.
const CONVERT_SOURCE = `
const sharp = require("sharp");
const [source, output, preview, tile, sequential] = process.argv.slice(1);
sharp.cache(false);
sharp.concurrency(1);
async function convert() {
  await sharp(source, { limitInputPixels: false, sequentialRead: sequential === "true", failOn: "warning" })
    .autoOrient().toColourspace("srgb")
    .tiff({ bigtiff: true, tile: true, tileWidth: Number(tile), tileHeight: Number(tile), compression: "deflate" })
    .toFile(output);
  await sharp(output, { limitInputPixels: false, sequentialRead: true, failOn: "warning" })
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 }).toFile(preview);
}
convert().catch(() => { process.exitCode = 1; });
`;

async function convertSource(directory: string, input: string, tiff: string, preview: string, sequential: boolean) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CONVERT_SOURCE, input, tiff, preview, String(TIFF_TILE_EDGE), String(sequential)], {
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory, VIPS_DISC_THRESHOLD: "16m" },
      stdio: "ignore",
      windowsHide: true,
      signal: AbortSignal.timeout(270_000),
    });
    let failure: Error | undefined;
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => code === 0 && !failure ? resolve() : reject(failure ?? new Error("Source conversion failed")));
  });
}

async function preparedSource(directory: string, id: string, width: number, height: number) {
  const preview = await readFile(path.join(directory, "preview.webp"));
  await touch(directory);
  return { id, width, height, preview: `data:image/webp;base64,${preview.toString("base64")}` };
}

async function supportedImageHeader(input: string) {
  const file = await open(input, "r");
  try {
    const header = Buffer.alloc(12);
    await file.read(header, 0, header.length, 0);
    return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
      (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP");
  } finally { await file.close(); }
}

export async function prepareTiledSource(userId: number, id: string) {
  const directory = jobDirectory(userId, id);
  return withWrite(path.dirname(directory), () => withWrite(directory, async () => {
    const manifest = await readManifest(directory);
    if (manifest.prepared) return preparedSource(directory, id, manifest.prepared.width, manifest.prepared.height);
    if (conversionActive) throw new TiledSourceError(503, "正在准备另一张大图，请稍后重试");
    conversionActive = true;
    const input = path.join(directory, "upload.bin");
    const tiff = path.join(directory, "source.tif");
    const preview = path.join(directory, "preview.webp");
    try {
      if ((await stat(input)).size !== manifest.bytes) throw new TiledSourceError(409, "源图还没有上传完整");
      const metadata = await supportedImageHeader(input)
        ? await sharp(input, { limitInputPixels: false, failOn: "warning" }).metadata().catch(() => null)
        : null;
      if (!metadata || !["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
        throw new TiledSourceError(415, "源图必须是静态 PNG、JPEG 或 WebP");
      }
      const { width, height } = metadata.autoOrient ?? metadata;
      if (!width || !height) throw new TiledSourceError(400, "无法读取源图尺寸");
      const tiffBytes = Math.ceil(width / TIFF_TILE_EDGE) * Math.ceil(height / TIFF_TILE_EDGE) * (TIFF_TILE_EDGE ** 2 * 4 + 1024) + MIB;
      const usage = await accountUsage(path.dirname(directory), directory);
      if (!Number.isSafeInteger(tiffBytes) || usage.bytes + manifest.bytes + tiffBytes > ACCOUNT_BYTES) {
        throw new TiledSourceError(413, "源图展开后超过账号可用的暂存空间");
      }
      if (Math.max(width, metadata.width ?? 0) * TIFF_TILE_EDGE * 4 > 96 * MIB) {
        throw new TiledSourceError(413, "源图单行太宽，无法安全分块");
      }
      const rawBytes = width * height * 4;
      // Progressive and WebP decoders may allocate the entire raster despite sequential output.
      if ((metadata.isProgressive || metadata.format === "webp") && rawBytes > 96 * MIB) {
        throw new TiledSourceError(415, "此格式的大图需要整张解码。请另存为非交错 PNG 或标准 JPEG 后上传");
      }
      const sequential = (metadata.orientation ?? 1) < 3;
      const reserve = tiffBytes + (sequential ? 0 : rawBytes);
      await diskCheck(directory, reserve);
      conversionDiskReservation = reserve;
      try { await convertSource(directory, input, tiff, preview, sequential); }
      catch { throw new TiledSourceError(422, "无法准备源图，请检查图片是否完整"); }
      const bytes = (await stat(tiff)).size + (await stat(preview)).size;
      const result = await preparedSource(directory, id, width, height);
      await writeManifest(directory, { ...manifest, prepared: { width, height, bytes } });
      await unlink(input).catch(() => undefined);
      return result;
    } catch (error) {
      await Promise.all([tiff, preview].map(file => unlink(file).catch(() => undefined)));
      throw error;
    } finally { conversionActive = false; conversionDiskReservation = 0; }
  }));
}

async function withCropSlot<T>(signal: AbortSignal, crop: () => Promise<T>) {
  if (cropSlotsUsed < 2) cropSlotsUsed++;
  else {
    if (cropWaiters.length >= 64) throw new TiledSourceError(429, "裁图请求过多，请稍后重试");
    await new Promise<void>(resolve => cropWaiters.push(resolve));
  }
  try {
    signal.throwIfAborted();
    return await crop();
  } finally {
    const next = cropWaiters.shift();
    if (next) next();
    else cropSlotsUsed--;
  }
}

// Close the native file on both Linux and Windows after every crop. libvips'
// process-wide cache can otherwise keep a TIFF handle open after its promise.
const CROP_SOURCE = `
const sharp = require("sharp");
const [input, ...args] = process.argv.slice(1);
const [x, y, width, height, resizeWidth, resizeHeight, left, top, right, bottom] = args.map(Number);
sharp.cache(false);
sharp.concurrency(1);
sharp(input, { limitInputPixels: false, sequentialRead: false })
  .extract({ left: x, top: y, width, height })
  .resize(resizeWidth, resizeHeight)
  .extend({ left, top, right, bottom, extendWith: "copy" })
  .png({ compressionLevel: 3 }).toBuffer()
  .then(png => process.stdout.write(png))
  .catch(() => { process.exitCode = 1; });
`;

async function cropSource(input: string, coordinates: number[], signal: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CROP_SOURCE, input, ...coordinates.map(String)], {
      stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size <= 5 * MIB) chunks.push(data);
      else child.kill();
    });
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      if (code === 0 && !failure && size > 0 && size <= 5 * MIB) resolve(Buffer.concat(chunks, size));
      else reject(failure ?? new Error("Source crop failed"));
    });
  });
}

export async function readTiledSourceTile(userId: number, id: string, scale: TileUpscaleFactor, index: number, signal: AbortSignal) {
  const directory = jobDirectory(userId, id);
  if (writes.has(directory)) throw new TiledSourceError(409, "源图正在处理，请稍后重试");
  readers.set(directory, (readers.get(directory) ?? 0) + 1);
  try {
    const manifest = await readManifest(directory);
    if (!manifest.prepared) throw new TiledSourceError(409, "源图尚未准备好");
    const { width, height } = manifest.prepared;
    const tile = imageUpscaleTileAt(describeImageTileUpscale(width, height, scale), index);
    await touch(directory);
    return await withCropSlot(signal, () => cropSource(path.join(directory, "source.tif"), [
      tile.sourceX, tile.sourceY, tile.sourceWidth, tile.sourceHeight, tile.inputWidth, tile.inputHeight, tile.inputX, tile.inputY,
      tile.requestWidth - tile.inputX - tile.inputWidth, tile.requestHeight - tile.inputY - tile.inputHeight,
    ], signal));
  } finally {
    const count = readers.get(directory) ?? 1;
    if (count === 1) readers.delete(directory);
    else readers.set(directory, count - 1);
  }
}

export async function deleteTiledSource(userId: number, id: string) {
  const directory = jobDirectory(userId, id);
  await withWrite(directory, () => removeSourceDirectory(directory));
}
