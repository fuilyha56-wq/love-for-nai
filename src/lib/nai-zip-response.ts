import JSZip from "jszip";
import sharp from "sharp";

const imageName = /\.(png|webp|jpe?g)$/i;
const isWebp = (bytes: Uint8Array) => bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
const isPng = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const isJpeg = (bytes: Uint8Array) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;

/** Launcher ZIP readers accept PNG/JPEG, but omit WebP entries entirely. */
export async function compatibleNaiZipResponse(source: Response): Promise<Response> {
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
    if (type.includes("json")) {
      const result = await source.json() as { data?: Array<{ b64_json?: unknown }>; usage?: unknown };
      const images = Array.isArray(result?.data) ? result.data : [];
      for (const item of images) {
        if (typeof item?.b64_json !== "string" || !item.b64_json.trim()) continue;
        const bytes = Buffer.from(item.b64_json.replace(/^data:image\/[^;]+;base64,/, ""), "base64");
        if (!bytes.length) throw new Error("empty image");
        archive.file(`image_${count++}.${isJpeg(bytes) ? "jpg" : "png"}`, isWebp(bytes) ? await png(bytes) : bytes);
      }
      headers.set("X-LFN-Usage", encodeURIComponent(JSON.stringify(result?.usage ?? null)));
      changed = true;
    } else {
      original = await source.arrayBuffer();
      const bytes = new Uint8Array(original);
      if (bytes[0] === 80 && bytes[1] === 75) {
        zip = await JSZip.loadAsync(original);
        const entries = Object.values(zip.files).filter(entry => !entry.dir && imageName.test(entry.name));
        for (const entry of entries) {
          if (/\.webp$/i.test(entry.name)) {
            const output = await png(await entry.async("uint8array"));
            let name = entry.name.replace(/\.webp$/i, ".png");
            while (zip.file(name)) name = `converted_${name}`;
            zip.remove(entry.name);
            zip.file(name, output);
            changed = true;
          }
          count++;
        }
      } else if (isPng(bytes) || isJpeg(bytes) || isWebp(bytes)) {
        archive.file(`image_0.${isJpeg(bytes) ? "jpg" : "png"}`, isWebp(bytes) ? await png(bytes) : bytes);
        count = 1;
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
