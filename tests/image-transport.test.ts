import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildImageTransportRequest, finishImageTransportImages, imageInstructionPrompt, inlineRaster, openAiAlphaMask, parseImageTransportResult } from "@/lib/image-transport";

async function imageUrl(color: string, width = 64, height = 64): Promise<string> {
  const png = await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
const generation = { model: "gpt-image-1.5", operation: "generate", prompt: "A blue teapot", width: 832, height: 1216, steps: 99, seed: 42, sampler: "k_euler" };

describe("多模型图像请求适配", () => {
  it("GPT generation 使用 JSON，不发送 response_format 和 NAI 扩散参数", async () => {
    const request = await buildImageTransportRequest({ ...generation, negative_prompt: "watermark", quality: "high", background: "transparent" }, "secret", "auto", 2);
    expect(request.path).toBe("/v1/images/generations");
    const payload = JSON.parse(request.body as string);
    expect(payload).toMatchObject({ model: "gpt-image-1.5", n: 2, size: "1024x1536", quality: "high", background: "transparent", output_format: "png" });
    expect(payload.prompt).toContain("Avoid including the following: watermark");
    for (const field of ["steps", "seed", "sampler", "negative_prompt", "response_format", "novelai_operation"]) expect(payload).not.toHaveProperty(field);
  });
  it("GPT2.5 保留有效自定义尺寸，支持新版质量且拒绝旧模型不支持的选项", async () => {
    const request = await buildImageTransportRequest({ ...generation, model: "gpt-image-2.5-sunburst", quality: "xhigh" }, "secret");
    expect(JSON.parse(request.body as string)).toMatchObject({ size: "832x1216", quality: "xhigh" });
    await expect(buildImageTransportRequest({ ...generation, quality: "max" }, "secret")).rejects.toThrow("质量选项");
    await expect(buildImageTransportRequest({ ...generation, model: "gemini-2.5-flash-image", imageSize: "4K" }, "secret", "gemini")).rejects.toThrow("输出分辨率");
  });
  it("GPT 编辑及多个参考图使用 multipart，蒙版白区变为透明 alpha", async () => {
    const original = await imageUrl("red");
    const maskData = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < maskData.length; i += 4) { maskData[i] = maskData[i + 1] = maskData[i + 2] = i < 64 * 32 * 4 ? 0 : 255; maskData[i + 3] = 255; }
    const mask = `data:image/png;base64,${(await sharp(maskData, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()).toString("base64")}`;
    const request = await buildImageTransportRequest({ ...generation, operation: "inpainting", image: original, mask, reference_image: await imageUrl("blue") }, "secret");
    expect(request.path).toBe("/v1/images/edits");
    expect(request.headers).not.toHaveProperty("Content-Type");
    const form = request.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    const nativeMask = form.get("mask") as Blob;
    const nativePixels = await sharp(Buffer.from(await nativeMask.arrayBuffer())).ensureAlpha().raw().toBuffer();
    expect(nativePixels[3]).toBe(255);
    expect(nativePixels[nativePixels.length - 1]).toBe(0);
    expect(await openAiAlphaMask(mask, original)).toEqual(Buffer.from(await nativeMask.arrayBuffer()));
    const output = await finishImageTransportImages({ image: original, mask }, [await imageUrl("green")]);
    const pixels = await sharp(inlineRaster(output[0]).bytes).raw().toBuffer();
    expect(Array.from(pixels.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(pixels.subarray(pixels.length - 4))).toEqual([0, 128, 0, 255]);
  });
  it("Gemini 原生使用 generateContent inlineData 和支持的 imageConfig", async () => {
    const request = await buildImageTransportRequest({ ...generation, model: "gemini-3-pro-image-preview", operation: "img2img", image: await imageUrl("red"), imageSize: "2K", characterPrompts: [{ prompt: "A sailor", center: { x: 0.2, y: 0.6 }, negativePrompt: "hat" }] }, "gemini-key", "gemini");
    expect(request.path).toBe("/v1beta/models/gemini-3-pro-image-preview:generateContent");
    expect(request.headers).toMatchObject({ "x-goog-api-key": "gemini-key" });
    expect(request.headers).not.toHaveProperty("Authorization");
    const payload = JSON.parse(request.body as string);
    expect(payload.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "2:3", imageSize: "2K" } });
    expect(payload.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
    expect(payload.contents[0].parts[0].text).toContain("Character 1: A sailor");
    expect(payload.contents[0].parts[0].text).toContain("20% of image width");
    expect(payload).not.toHaveProperty("negative_prompt");
  });
  it("显式聊天图像协议发送图像消息，不猜网关端点", async () => {
    const request = await buildImageTransportRequest({ ...generation, model: "my-alias", operation: "director-lineart", image: await imageUrl("red") }, "secret", "openai-chat-images");
    expect(request.path).toBe("/v1/chat/completions");
    const payload = JSON.parse(request.body as string);
    expect(payload.modalities).toEqual(["text", "image"]);
    expect(payload.messages[0].content[0].text).toContain("clean black line art");
    expect(payload.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
  it("个人NAI兼容来源保留扩散参数，图片使用原有纯base64网关格式", async () => {
    const image = await imageUrl("red");
    const request = await buildImageTransportRequest({ ...generation, model: "nai-v5-full", operation: "img2img", steps: 28, image, strength: 0.6, reference_image: image }, "secret", "auto");
    const payload = JSON.parse(request.body as string);
    expect(payload).toMatchObject({ model: "nai-v5-full", novelai_operation: "img2img", steps: 28, seed: 42, sampler: "k_euler", strength: 0.6, image: image.split(",")[1], reference_image: image.split(",")[1] });
    await expect(buildImageTransportRequest({ ...generation, model: "nai-v5-full" }, "secret")).rejects.toThrow("steps");
  });
  it("拒绝无图片编辑、未知模型编辑、错误蒙版、伪图像与任意 URL", async () => {
    await expect(buildImageTransportRequest({ ...generation, operation: "img2img" }, "secret")).rejects.toThrow("待编辑图片");
    await expect(buildImageTransportRequest({ ...generation, model: "unknown", operation: "img2img", image: await imageUrl("red") }, "secret")).rejects.toThrow("不支持此操作");
    await expect(buildImageTransportRequest({ ...generation, operation: "inpainting", image: await imageUrl("red"), mask: await imageUrl("white", 32, 32) }, "secret")).rejects.toThrow("蒙版尺寸");
    expect(() => inlineRaster("https://127.0.0.1/private")).toThrow("base64");
    expect(() => inlineRaster("data:image/png;base64,aGVsbG8=")).toThrow("格式");
  });
  it("自然语言转换保留负面、角色与参考目的，而不携带 NAI 参数名", () => {
    const prompt = imageInstructionPrompt({ operation: "precise-reference", prompt: "A girl", negativePrompt: "text", characterPrompts: [{ prompt: "red hair" }] }, [{ label: "character参考 1" }]);
    expect(prompt).toContain("subject identity and style");
    expect(prompt).toContain("Avoid including the following: text");
    expect(prompt).toContain("Character 1: red hair");
  });
});

describe("多模型图像响应归一化", () => {
  it("兼容 OpenAI images、Gemini inlineData/snake_case，以及聊天图像块", () => {
    expect(parseImageTransportResult({ data: [{ b64_json: "aGVsbG8=" }], usage: { x: 1 } }).images).toEqual(["data:image/png;base64,aGVsbG8="]);
    expect(parseImageTransportResult({ candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: "image/png", data: "ignored" } }, { text: "Done" }, { inline_data: { mime_type: "image/jpeg", data: "aGVsbG8=" } }] } }], usageMetadata: { totalTokenCount: 2 } })).toEqual({ images: ["data:image/jpeg;base64,aGVsbG8="], usage: { totalTokenCount: 2 }, text: "Done" });
    expect(parseImageTransportResult({ choices: [{ message: { content: "Done", images: [{ image_url: { url: "https://images.example.com/a.png" } }, { image_url: { url: "javascript:alert(1)" } }] } }] }).images).toEqual(["https://images.example.com/a.png"]);
  });
  it("兼容网关的 Markdown 图像回复，不将普通文本作为图片", () => {
    expect(parseImageTransportResult({ choices: [{ message: { content: "![result](https://images.example.com/a.png)" } }] }).images).toEqual(["https://images.example.com/a.png"]);
    expect(parseImageTransportResult({ choices: [{ message: { content: "Unable to create the image" } }] }).images).toEqual([]);
  });
});
