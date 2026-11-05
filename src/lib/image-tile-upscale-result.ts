import { randomUUID } from "node:crypto";
import { mkdir, open, opendir, readFile, rename, rm, stat, statfs, utimes, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createDeflate } from "node:zlib";
import sharp from "sharp";
import { describeImageTileUpscale, imageUpscaleTileAt, TILE_UPSCALE_EDGE, TILE_UPSCALE_MAX_FREE_PIXELS, type ImageUpscaleLayout, type TileUpscaleFactor } from "./image-tile-upscale";

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const PNG_MAX_EDGE = 0x7fffffff;
const RESULT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RESULT_DIRECTORY = /^\d+-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TILE_FILENAME = /^tile-\d+\.png$/;
const METADATA_FILENAME = "layout.json";
const rootDirectory = () => path.resolve(process.env.LFN_DATA_DIR || "data", "tiled-upscale-results");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_UNFILTERED_SCANLINE = Buffer.from([0]);
const RGBA_BYTES = 4;
const DISK_RESERVE_BYTES = BigInt(512 * 1024 ** 2);
const HEAVY_EXPORT_PIXELS = BigInt(16_000_000);

export class TiledUpscaleResultError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type TiledUpscaleResult = { directory: string; layout: ImageUpscaleLayout };
let lastCleanup = 0;
let reservedDiskBytes = BigInt(0);
let exportingLargeImage = false;

async function reserveDiskSpace(directory: string, bytes: bigint): Promise<() => void> {
  const { bavail, bsize } = await statfs(directory, { bigint: true });
  if (bavail * bsize < DISK_RESERVE_BYTES + reservedDiskBytes + bytes) {
    throw new TiledUpscaleResultError("服务器剩余存储空间不足，无法暂存或导出分块图像。", 507);
  }
  reservedDiskBytes += bytes;
  return () => { reservedDiskBytes -= bytes; };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function resultDirectory(userId: number, id: string): string {
  if (!Number.isSafeInteger(userId) || userId < 1 || !RESULT_ID.test(id)) {
    throw new TiledUpscaleResultError("未找到分块超分结果", 404);
  }
  return path.join(rootDirectory(), `${userId}-${id}`);
}

function tileFile(directory: string, index: number): string {
  return path.join(directory, `tile-${index}.png`);
}

async function cleanupExpiredResults(root: string) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for await (const entry of await opendir(root)) {
    if (!entry.isDirectory() || !RESULT_DIRECTORY.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const lastUsed = await stat(path.join(directory, METADATA_FILENAME)).catch(() => stat(directory)).catch(() => null);
    if (lastUsed && now - lastUsed.mtimeMs >= RESULT_TTL_MS) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function createTiledUpscaleResult(userId: number, width: number, height: number, scale: TileUpscaleFactor): Promise<string> {
  const layout = describeImageTileUpscale(width, height, scale);
  if (layout.outputWidth > PNG_MAX_EDGE || layout.outputHeight > PNG_MAX_EDGE) {
    throw new RangeError("目标尺寸超出 PNG 格式可表示的范围");
  }
  const root = rootDirectory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await cleanupExpiredResults(root);
  const id = randomUUID();
  const directory = resultDirectory(userId, id);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(path.join(directory, METADATA_FILENAME), JSON.stringify({ width, height, scale }), { mode: 0o600 });
  return id;
}

export async function openTiledUpscaleResult(userId: number, id: string): Promise<TiledUpscaleResult> {
  const directory = resultDirectory(userId, id);
  const file = path.join(directory, METADATA_FILENAME);
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs >= RESULT_TTL_MS) throw new TiledUpscaleResultError("分块超分结果已过期", 404);
    const { width, height, scale } = JSON.parse(await readFile(file, "utf8")) as { width: number; height: number; scale: TileUpscaleFactor };
    const now = new Date();
    await utimes(file, now, now);
    return { directory, layout: describeImageTileUpscale(width, height, scale) };
  } catch (error) {
    if (isMissing(error)) throw new TiledUpscaleResultError("未找到分块超分结果", 404);
    throw error;
  }
}

export async function saveTiledUpscaleResultTile(result: TiledUpscaleResult, index: number, raster: Buffer) {
  const { directory, layout } = result;
  const tile = imageUpscaleTileAt(layout, index);
  const file = tileFile(directory, index);
  const image = sharp(raster, { limitInputPixels: TILE_UPSCALE_MAX_FREE_PIXELS });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata || !["png", "jpeg", "webp"].includes(metadata.format) || metadata.width !== TILE_UPSCALE_EDGE || metadata.height !== TILE_UPSCALE_EDGE || (metadata.pages ?? 1) !== 1) {
    throw new TiledUpscaleResultError("分块结果必须是 1024×1024 的 PNG、JPEG 或 WebP 图片", 400);
  }
  const core = await image.extract({ left: tile.cropX, top: tile.cropY, width: tile.coreWidth, height: tile.coreHeight })
    .png({ compressionLevel: 1 }).toBuffer().catch(() => null);
  if (!core) throw new TiledUpscaleResultError("无法解码分块结果", 400);
  const temporary = path.join(directory, `upload-${randomUUID()}.tmp`);
  const release = await reserveDiskSpace(directory, BigInt(core.byteLength));
  try {
    await writeFile(temporary, core, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    release();
  }
}

export async function assertTiledUpscaleResultComplete(result: TiledUpscaleResult) {
  let tiles = 0;
  for await (const entry of await opendir(result.directory)) {
    if (entry.isFile() && TILE_FILENAME.test(entry.name)) tiles += 1;
  }
  if (tiles !== result.layout.rows * result.layout.columns) {
    throw new TiledUpscaleResultError("还有分块未完成，暂时无法下载", 409);
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

async function writeFully(file: FileHandle, bytes: Buffer, offset: number, length: number, position: number) {
  for (let written = 0; written < length;) {
    const { bytesWritten } = await file.write(bytes, offset + written, length - written, position + written);
    if (!bytesWritten) throw new Error("无法写入拼接临时文件");
    written += bytesWritten;
  }
}

async function readFully(file: FileHandle, bytes: Buffer, position: number) {
  for (let read = 0; read < bytes.length;) {
    const { bytesRead } = await file.read(bytes, read, bytes.length - read, position + read);
    if (!bytesRead) throw new Error("拼接临时文件数据不完整");
    read += bytesRead;
  }
}

/** One decoded tile, one output stripe on disk, and fixed-size chunks in memory. */
async function* resultScanlines({ directory, layout }: TiledUpscaleResult, signal: AbortSignal): AsyncGenerator<Buffer> {
  const filename = path.join(directory, `stripe-${randomUUID()}.tmp`);
  const stripe = await open(filename, "wx+", 0o600);
  const rowSize = layout.outputWidth * RGBA_BYTES;
  try {
    for (let row = 0; row < layout.rows; row += 1) {
      const rowHeight = imageUpscaleTileAt(layout, row * layout.columns).coreHeight;
      for (let column = 0; column < layout.columns; column += 1) {
        signal.throwIfAborted();
        const tile = imageUpscaleTileAt(layout, row * layout.columns + column);
        const pixels = await sharp(tileFile(directory, tile.index), { limitInputPixels: TILE_UPSCALE_MAX_FREE_PIXELS })
          .toColourspace("srgb").ensureAlpha().raw().toBuffer();
        const width = tile.coreWidth * RGBA_BYTES;
        for (let y = 0; y < rowHeight; y += 1) {
          signal.throwIfAborted();
          await writeFully(stripe, pixels, y * width, width, y * rowSize + tile.coreX * RGBA_BYTES);
        }
      }
      for (let y = 0; y < rowHeight; y += 1) {
        yield PNG_UNFILTERED_SCANLINE;
        for (let offset = 0; offset < rowSize;) {
          signal.throwIfAborted();
          const bytes = Buffer.allocUnsafe(Math.min(64 * 1024, rowSize - offset));
          await readFully(stripe, bytes, y * rowSize + offset);
          yield bytes;
          offset += bytes.length;
        }
      }
    }
  } finally {
    await stripe.close().finally(() => rm(filename, { force: true }).catch(() => undefined));
  }
}

async function* resultPng(result: TiledUpscaleResult, signal: AbortSignal): AsyncGenerator<Buffer> {
  signal.throwIfAborted();
  const header = Buffer.alloc(13);
  header.writeUInt32BE(result.layout.outputWidth);
  header.writeUInt32BE(result.layout.outputHeight, 4);
  header[8] = 8;
  header[9] = 6;
  yield PNG_SIGNATURE;
  yield pngChunk("IHDR", header);
  const source = Readable.from(resultScanlines(result, signal), { objectMode: false });
  const encoder = createDeflate({ level: 1 });
  const compression = pipeline(source, encoder, { signal }).then(() => undefined, (error: unknown) => error);
  try {
    for await (const chunk of encoder) yield pngChunk("IDAT", chunk);
    const error = await compression;
    if (error) throw error;
    yield pngChunk("IEND", Buffer.alloc(0));
  } finally {
    source.destroy();
    encoder.destroy();
    await compression;
  }
}

export async function streamTiledUpscaleResult(result: TiledUpscaleResult, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  signal.throwIfAborted();
  const { outputWidth, outputHeight } = result.layout;
  const large = BigInt(outputWidth) * BigInt(outputHeight) > HEAVY_EXPORT_PIXELS;
  if (large && exportingLargeImage) throw new TiledUpscaleResultError("服务器正在导出另一张大图，请稍后再下载。", 429);
  if (large) exportingLargeImage = true;

  let releaseDisk: (() => void) | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseDisk?.();
    if (large) exportingLargeImage = false;
  };
  try {
    const maximumStripeRows = imageUpscaleTileAt(result.layout, 0).coreHeight;
    const stripeBytes = BigInt(outputWidth) * BigInt(RGBA_BYTES) * BigInt(maximumStripeRows);
    releaseDisk = await reserveDiskSpace(result.directory, stripeBytes);
    signal.throwIfAborted();
  } catch (error) {
    release();
    throw error;
  }

  const controller = new AbortController();
  const chunks = resultPng(result, controller.signal);
  const cleanup = () => {
    signal.removeEventListener("abort", abort);
    release();
  };
  const close = async (reason: unknown) => {
    controller.abort(reason);
    try { await chunks.return(undefined); }
    finally { cleanup(); }
  };
  const abort = () => { void close(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const next = await chunks.next();
        if (next.done) { cleanup(); stream.close(); }
        else stream.enqueue(next.value);
      } catch (error) {
        cleanup();
        stream.error(error);
      }
    },
    async cancel(reason) {
      await close(reason).catch(() => undefined);
    },
  });
}
