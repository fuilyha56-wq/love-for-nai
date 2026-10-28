import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getUserAvatar, purchaseAvatarChange } from "@/lib/aff";

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "avatars");
export const AVATAR_COST = 5;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export async function saveAvatar(userId: number, input: Buffer, requestId: string, crop = { x: 0, y: 0, zoom: 1 }) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error("头像保存请求无效");
  if (!input.length || input.length > MAX_AVATAR_BYTES) throw new Error("头像图片不能超过 5 MB");
  if (![crop.x, crop.y, crop.zoom].every(Number.isFinite) || Math.abs(crop.x) > 1 || Math.abs(crop.y) > 1 || crop.zoom < 1 || crop.zoom > 3) throw new Error("头像裁剪参数无效");
  const metadata = await sharp(input, { limitInputPixels: 16_777_216, animated: false }).metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("头像只支持 PNG、JPEG 或 WebP 静态图片");
  if ((metadata.pages || 1) > 1) throw new Error("请使用静态头像图片");
  const normalized = await sharp(input, { limitInputPixels: 16_777_216 }).rotate().toBuffer({ resolveWithObject: true });
  const side = Math.max(1, Math.floor(Math.min(normalized.info.width, normalized.info.height) / crop.zoom));
  const left = Math.round((normalized.info.width - side) * (crop.x + 1) / 2);
  const top = Math.round((normalized.info.height - side) * (crop.y + 1) / 2);
  const output = await sharp(normalized.data).extract({ left, top, width: side, height: side }).resize(256, 256).webp({ quality: 80, effort: 4 }).toBuffer();
  const hash = createHash("sha256").update(output).digest("hex");
  const directory = path.join(root(), String(userId));
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${hash}.webp`), temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, output);
  await rename(temporary, target);
  return purchaseAvatarChange(userId, requestId, hash);
}
export async function readAvatar(userId: number) {
  const avatar = await getUserAvatar(userId);
  if (!avatar) return null;
  return { data: await readFile(path.join(root(), String(userId), `${avatar.hash}.webp`)), hash: avatar.hash };
}
