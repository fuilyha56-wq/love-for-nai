import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { generateNovelaiImage } from "@/lib/provider/novelai";

afterEach(() => vi.unstubAllGlobals());

describe("NovelAI 官方 Key 生图响应", () => {
  it("解包官方 ZIP 中的 PNG，并按 image 序号返回", async () => {
    const archive = new JSZip();
    archive.file("image_1.png", Buffer.from("second"));
    archive.file("metadata.json", "{}");
    archive.file("image_0.png", Buffer.from("first"));
    const zip = await archive.generateAsync({ type: "uint8array" });
    const payload = new ArrayBuffer(zip.byteLength);
    new Uint8Array(payload).set(zip);
    const upstream = vi.fn(async () => new Response(payload, { headers: { "Content-Type": "application/zip" } }));
    vi.stubGlobal("fetch", upstream);

    const body = { model: "nai-diffusion-5-full", input: "cat", action: "generate" };
    const images = await generateNovelaiImage("pst-own-key", body);

    expect(images).toEqual([
      `data:image/png;base64,${Buffer.from("first").toString("base64")}`,
      `data:image/png;base64,${Buffer.from("second").toString("base64")}`,
    ]);
    expect(upstream).toHaveBeenCalledWith("https://image.novelai.net/ai/generate-image", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer pst-own-key" }),
      body: JSON.stringify(body),
    }));
  });

  it("兼容返回 JSON 图片的代理", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ images: [{ image: Buffer.from("image").toString("base64") }] })));
    await expect(generateNovelaiImage("pst-own-key", { input: "cat" })).resolves.toEqual([
      `data:image/png;base64,${Buffer.from("image").toString("base64")}`,
    ]);
  });
});
