import JSZip from "jszip";
import sharp from "sharp";
import { detectWatermarkImageMime } from "./image-watermark-container";

const imageName = /\.(png|webp|jpe?g)$/i;
const dataImage = /^data:image\/[\w.+-]+;base64,/i;

export async function readNaiJsonImages(payload: unknown): Promise<Buffer[]> {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const rows = Array.isArray(payload) ? payload : Array.isArray(root.data) ? root.data : Array.isArray(root.images) ? root.images : [root.data || root];
  const images: Buffer[] = [];
  for (const row of rows) {
    const fields = row && typeof row === "object" ? row as Record<string, unknown> : {};
    let value = typeof row === "string" ? row : fields.b64_json || fields.image || fields.url;
    if (typeof value !== "string" || !value.trim()) continue;
    if (/^https?:\/\//i.test(value)) value = await (await import("./provider/http")).downloadProviderImage(value);
    if (typeof value !== "string") continue;
    const bytes = Buffer.from(value.replace(dataImage, ""), "base64");
    if (!detectWatermarkImageMime(bytes)) throw new Error("invalid image");
    images.push(bytes);
  }
  return images;
}

/** Launcher ZIP readers accept PNG/JPEG, but omit WebP entries entirely. */
export async function compatibleNaiZipResponse(source: Response, preserveWebp = false): Promise<Response> {
  const headers = new Headers(source.headers);
  for (const key of ["content-length", "content-encoding", "content-range", "content-md5", "digest", "etag"])
    headers.delete(key);
  try {
    const type = (headers.get("content-type") || "").toLowerCase();
    const archive = new JSZip();
    let zip = archive;
    let count = 0;
    let changed = false;
    let original: ArrayBuffer | undefined;
    const png = async (bytes: Uint8Array) => sharp(bytes, { limitInputPixels: 32 * 1024 * 1024 }).keepMetadata().png().toBuffer();
    const append = async (bytes: Uint8Array) => {
      const mime = detectWatermarkImageMime(bytes);
      if (!mime) throw new Error("invalid image");
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" && preserveWebp ? "webp" : "png";
      archive.file(`image_${count++}.${ext}`, mime === "image/webp" && !preserveWebp ? await png(bytes) : bytes);
    };
    if (type.includes("json")) {
      const result = await source.json() as { usage?: unknown };
      for (const bytes of await readNaiJsonImages(result)) await append(bytes);
      headers.set("X-LFN-Usage", encodeURIComponent(JSON.stringify(result?.usage ?? null)));
      changed = true;
    } else {
      original = await source.arrayBuffer();
      const bytes = new Uint8Array(original);
      if (bytes[0] === 80 && bytes[1] === 75) {
        zip = await JSZip.loadAsync(original);
        const entries = Object.values(zip.files).filter(entry => !entry.dir && imageName.test(entry.name));
        for (const entry of entries) {
          if (!preserveWebp && /\.webp$/i.test(entry.name)) {
            const output = await png(await entry.async("uint8array"));
            let name = entry.name.replace(/\.webp$/i, ".png");
            while (zip.file(name)) name = `converted_${name}`;
            zip.remove(entry.name);
            zip.file(name, output);
            changed = true;
          }
          count++;
        }
      } else if (detectWatermarkImageMime(bytes)) {
        await append(bytes);
        changed = true;
      }
    }
    if (!count) throw new Error("no images");
    const body = !changed && original ? original : await zip.generateAsync({ type: "arraybuffer" });
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", 'attachment; filename="images.zip"');
    headers.set("Content-Length", String(body.byteLength));
    headers.set("X-LFN-Generated-Samples", String(count));
    return new Response(body, { status: source.status, headers });
  } catch {
    return Response.json({ message: "上游未返回可解码的图片 ZIP 或 base64 图片", error: { code: "lfn_native_invalid_image_response", message: "上游未返回可解码的图片 ZIP 或 base64 图片" } }, { status: 502 });
  }
}
