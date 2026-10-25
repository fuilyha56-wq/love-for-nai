import path from "node:path";
import sharp from "sharp";
import { preserveWatermarkAfterMetadataStrip } from "@/lib/image-watermark";

const MAX_IMAGE_PIXELS = 16_777_216;

export async function createImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
}

export async function stripImageMetadata(
  buffer: Buffer,
  fileName: string,
): Promise<{ data: Buffer; extension: string }> {
  const originalExtension = path.extname(fileName).toLowerCase();
  const image = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  const detectedFormat = (await image.metadata()).format;
  const format = detectedFormat === "png" || detectedFormat === "jpeg" || detectedFormat === "webp"
    ? detectedFormat
    : originalExtension === ".jpg" || originalExtension === ".jpeg"
      ? "jpeg"
      : originalExtension === ".webp" ? "webp" : "png";
  const data = format === "jpeg"
    ? await image.jpeg({ quality: 95 }).toBuffer()
    : format === "webp"
      ? await image.webp({ quality: 95 }).toBuffer()
      : await image.png({ compressionLevel: 9 }).toBuffer();
  return { data: await preserveWatermarkAfterMetadataStrip(buffer, data), extension: format === "jpeg" ? "jpg" : format };
}
