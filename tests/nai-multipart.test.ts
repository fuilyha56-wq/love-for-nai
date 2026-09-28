import { describe, expect, it } from "vitest";

import { parseNaiGenerationBody } from "@/lib/compat-api";

function pngBytes(): Uint8Array<ArrayBuffer> {
  // 最小 PNG 头即可，解析器只做 base64 转换不校验内容。
  const bytes = new Uint8Array(8);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

describe("NAI multipart 生图请求解析", () => {
  it("还原 request 部件 JSON 并把图片部件转回 base64", async () => {
    const form = new FormData();
    form.append(
      "request",
      new File(
        [
          JSON.stringify({
            input: "1girl",
            model: "nai-diffusion-5-full",
            action: "img2img",
            image: "image",
            parameters: {
              mask: "mask",
              reference_image: "reference_image",
              reference_image_multiple_cached: [
                { cache_secret_key: "a", data: "ref_multiple_0" },
              ],
              director_reference_images_cached: [
                { data: "director_ref_0" },
              ],
              image_cache_secret_key: "hash-1",
              width: 832,
              height: 1216,
            },
          }),
        ],
        "blob",
        { type: "application/json" },
      ),
    );
    form.append("image", new File([pngBytes()], "blob", { type: "image/png" }));
    form.append("mask", new File([pngBytes()], "blob", { type: "image/png" }));
    form.append("reference_image", new File([pngBytes()], "blob", { type: "image/png" }));
    form.append("ref_multiple_0", new File([pngBytes()], "blob", { type: "image/png" }));
    form.append("director_ref_0", new File([pngBytes()], "blob", { type: "image/png" }));

    const request = new Request("http://localhost/ai/generate-image", {
      method: "POST",
      body: form,
    });
    const body = await parseNaiGenerationBody(request);
    const parameters = body.parameters as Record<string, unknown>;

    expect(body.image).toBe(Buffer.from(pngBytes()).toString("base64"));
    expect(parameters.mask).toBe(Buffer.from(pngBytes()).toString("base64"));
    expect(parameters.reference_image).toBe(Buffer.from(pngBytes()).toString("base64"));
    const refList = parameters.reference_image_multiple_cached as Array<Record<string, string>>;
    expect(refList[0].data).toBe(Buffer.from(pngBytes()).toString("base64"));
    const dirList = parameters.director_reference_images_cached as Array<Record<string, string>>;
    expect(dirList[0].data).toBe(Buffer.from(pngBytes()).toString("base64"));
    // 非图片字段不受影响。
    expect(parameters.image_cache_secret_key).toBe("hash-1");
    expect(parameters.width).toBe(832);
  });

  it("纯 JSON 请求原样返回", async () => {
    const request = new Request("http://localhost/ai/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "1girl", model: "nai-diffusion-5-full" }),
    });
    const body = await parseNaiGenerationBody(request);
    expect(body.input).toBe("1girl");
  });

  it("multipart 缺少 request 部件时抛错", async () => {
    const form = new FormData();
    form.append("image", new File([pngBytes()], "blob", { type: "image/png" }));
    const request = new Request("http://localhost/ai/generate-image", {
      method: "POST",
      body: form,
    });
    await expect(parseNaiGenerationBody(request)).rejects.toThrow();
  });
});
