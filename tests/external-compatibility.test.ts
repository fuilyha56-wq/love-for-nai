import { describe, expect, it } from "vitest";
import { externalGeneration, imageOperationFromBody, imageReferenceCountFromBody, isNaiExternalModel, naiZipResponse } from "@/lib/compat-api";
import { externalCorsPreflight } from "@/lib/external-cors";

describe("外部图片 API 兼容边界", () => {
  it("保留 NAI limit/非 limit 模型，同时允许独立 NewAPI 图像模型", () => {
    expect(externalGeneration({ model: "nai-v5-full-limit", size: "512x512", n: 1 })?.model).toBe("nai-v5-full-limit");
    expect(externalGeneration({ model: "nai-v5-full", size: "512x512", n: 1 })?.model).toBe("nai-v5-full");
    expect(externalGeneration({ model: "provider-image-model", size: "1024x1024", n: 1 })?.model).toBe("provider-image-model");
  });

  it("接受官方 NAI 模型名和 Medium 别名", () => {
    expect(externalGeneration({ model: "nai-diffusion-5-full", size: "512x512", n: 1 })?.model).toBe("nai-v5-full");
    expect(externalGeneration({ model: "nai-v5-full-medium", size: "512x512", n: 1 })?.steps).toBe(14);
  });

  it("Precise Reference 将完整参考数与 Gateway 计费参数送入扣款对象", () => {
    const body = {
      model: "nai-diffusion-5-full",
      size: "832x1216",
      n: 2,
      steps: 29,
      uncond_scale: 1.5,
      references: [{ reference_image: "a" }, { reference_image: "b" }],
    };
    const operation = imageOperationFromBody(body);
    const generation = externalGeneration({
      ...body,
      operation,
      referenceImageCount: imageReferenceCountFromBody(body, operation),
    }, operation);
    expect(generation).toMatchObject({
      operation: "precise-reference",
      referenceImageCount: 2,
      uncondScale: 1.5,
    });
  });

  it("区分 Vibe、角色参考与编辑端点的参考图计数", () => {
    expect(imageReferenceCountFromBody({ reference_images: ["a", "b"] }, "vibe-transfer")).toBe(2);
    expect(imageReferenceCountFromBody({ characters: [{}, {}, {}] }, "character-reference")).toBe(3);
    expect(imageReferenceCountFromBody({ image: "source" }, "edits")).toBe(0);
  });

  it("为浏览器图片客户端提供预检响应", () => {
    const response = externalCorsPreflight();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("识别 st-chatu8 的原生 NAI 请求而不把独立模型当作 NAI", () => {
    const body = {
      input: "1girl",
      model: "nai-diffusion-5-full",
      action: "generate",
      parameters: { width: 512, height: 512, steps: 28, sampler: "k_euler_ancestral" },
    };
    expect(isNaiExternalModel(body.model)).toBe(true);
    expect(externalGeneration({ ...body.parameters, model: body.model })?.model).toBe("nai-v5-full");
    expect(isNaiExternalModel("provider-image-model")).toBe(false);
  });

  it("原生 NAI ZIP 响应保留浏览器 CORS 头", async () => {
    const response = await naiZipResponse(Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/zip");
  });
});