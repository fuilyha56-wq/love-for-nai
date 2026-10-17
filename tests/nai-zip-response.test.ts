import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { compatibleNaiZipResponse } from "@/lib/nai-zip-response";

// Matches Aaalice 4.3.0 ZipUtils.extractAllImages (PNG/JPG/JPEG only).
const launcherEntries = (zip: JSZip) => Object.values(zip.files).filter(e => !e.dir && /\.(png|jpe?g)$/i.test(e.name));
const load = async (response: Response) => JSZip.loadAsync(await response.arrayBuffer());
const image = (format: "png" | "webp" | "jpeg") => sharp({ create: { width: 8, height: 8, channels: 4, background: "#89abcd" } }).toFormat(format).toBuffer();
describe("native ZIP compatibility with Launcher readers", () => {
  it("converts WebP-only archives that previously produced no Launcher images", async () => {
    const webp = await image("webp");
    const input = await new JSZip().file("image_0.webp", webp).file("notes.txt", "retain").generateAsync({ type: "arraybuffer" });
    expect(launcherEntries(await JSZip.loadAsync(input))).toHaveLength(0);
    const result = await compatibleNaiZipResponse(new Response(input, { headers: { "content-type": "application/zip", etag: "old", "x-lfn-payment-source": "package" } }));
    expect(result.status).toBe(200); expect(result.headers.get("content-type")).toBe("application/zip"); expect(result.headers.get("etag")).toBeNull(); expect(result.headers.get("x-lfn-payment-source")).toBe("package");
    const zip = await load(result); expect(launcherEntries(zip)).toHaveLength(1); expect(await zip.file("notes.txt")!.async("string")).toBe("retain");
    const converted = await zip.file("image_0.png")!.async("nodebuffer");
    expect((await sharp(converted).metadata()).format).toBe("png");
    expect(await sharp(converted).ensureAlpha().raw().toBuffer()).toEqual(await sharp(webp).ensureAlpha().raw().toBuffer());
  });
  it("retains PNG archive bytes and metadata files without recompressing", async () => {
    const input = await new JSZip().file("image_0.png", await image("png")).file("notes.txt", "keep").generateAsync({ type: "arraybuffer" });
    const result = await compatibleNaiZipResponse(new Response(input, { headers: { "content-type": "application/octet-stream" } }));
    expect(result.headers.get("x-lfn-generated-samples")).toBe("1"); expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.from(input));
  });
  it("keeps colliding existing PNG entries when converting WebP", async () => {
    const input = await new JSZip().file("one.webp", await image("webp")).file("one.png", await image("png")).generateAsync({ type: "arraybuffer" });
    const zip = await load(await compatibleNaiZipResponse(new Response(input, { headers: { "content-type": "application/zip" } })));
    expect(launcherEntries(zip)).toHaveLength(2); expect(zip.file("converted_one.png")).not.toBeNull();
  });
  for (const format of ["png", "webp", "jpeg"] as const) it(`packages raw ${format} bytes as a Launcher-readable ZIP`, async () => {
    const bytes = await image(format), result = await compatibleNaiZipResponse(new Response(new Uint8Array(bytes), { headers: { "content-type": `image/${format}` } }));
    expect(result.status).toBe(200); const zip = await load(result); expect(launcherEntries(zip)).toHaveLength(1);
  });
  it("normalizes WebP inside OpenAI base64 results", async () => {
    const bytes = await image("webp"); const response = await compatibleNaiZipResponse(Response.json({ data: [{ b64_json: bytes.toString("base64") }] }));
    const zip = await load(response); expect((await sharp(await zip.file("image_0.png")!.async("nodebuffer")).metadata()).format).toBe("png");
  });
  for (const body of ["not-a-zip", "<html>error</html>"]) it("reports a structured error instead of a successful empty ZIP", async () => {
    const result = await compatibleNaiZipResponse(new Response(body, { headers: { "content-type": "application/zip" } }));
    expect(result.status).toBe(502); expect((await result.json()).error.code).toBe("lfn_native_invalid_image_response");
  });
  it("rejects a ZIP with no image entries", async () => {
    const input = await new JSZip().file("error.txt", "not a picture").generateAsync({ type: "arraybuffer" });
    expect((await compatibleNaiZipResponse(new Response(input, { headers: { "content-type": "application/zip" } }))).status).toBe(502);
  });
});
