import { describe, expect, it } from "vitest";
import { externalGeneration, imageOperationFromBody, imageReferenceCountFromBody, isNaiExternalModel, naiZipResponse } from "@/lib/compat-api";
import { externalCorsPreflight } from "@/lib/external-cors";
import { affCost } from "@/lib/image-pricing";

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
    expect(imageReferenceCountFromBody({ characters: [{}, { reference_image: "a" }, {}] }, "character-reference")).toBe(1);
    expect(imageReferenceCountFromBody({ image: "source" }, "edits")).toBe(0);
  });

  it("显式 generate 的嵌套精准参考按参考费收费", () => {
    const generation = externalGeneration({
      model: "nai-diffusion-5-full",
      action: "generate",
      parameters: {
        width: 832, height: 1216, steps: 28, n_samples: 1,
        director_reference_images_cached: [{ data: "reference" }],
      },
    });
    expect(generation).toMatchObject({ operation: "precise-reference", referenceMode: "precise", referenceImageCount: 1 });
    expect(affCost(generation!)).toBe(180);
  });

  it("缓存 Vibe 不重复编码，已编码引用仍可使用本地档内价", () => {
    const generation = externalGeneration({
      model: "nai-diffusion-5-full",
      action: "generate",
      parameters: {
        width: 832, height: 1216, steps: 28, n_samples: 1,
        reference_image_multiple_cached: [{ data: "A".repeat(1200) }],
      },
    });
    expect(generation).toMatchObject({ referenceImageCount: 1, encodedVibeCount: 1 });
    expect(affCost(generation!)).toBe(5);
  });

  it("重绘按 inpaintImg2ImgStrength 而非图生图 strength 计算", () => {
    const body = { model: "nai-v5-inpaint", width: 832, height: 1216, steps: 29, n: 1, strength: 0.1 };
    const inpaint = externalGeneration(body, "inpainting");
    const img2img = externalGeneration(body, "img2img");
    expect(inpaint?.strength).toBe(1);
    expect(affCost(inpaint!)).toBe(155);
    expect(affCost(img2img!)).toBe(20);
    const preciseInpaint = externalGeneration({ ...body, director_reference_images: ["reference"] }, "inpainting");
    expect(affCost(preciseInpaint!)).toBe(180);
  });

  it("嵌套图生图缺省强度为 0.7，原生 infill 使用自己的强度", () => {
    const body = { model: "nai-diffusion-5-full", parameters: { width: 832, height: 1216, steps: 29, n_samples: 1 } };
    const img2img = externalGeneration({ ...body, action: "img2img" });
    expect(img2img).toMatchObject({ operation: "img2img", strength: 0.7 });
    expect(affCost(img2img!)).toBe(110);
    const infill = externalGeneration({ ...body, action: "infill", parameters: { ...body.parameters, strength: 0.1, inpaintImg2ImgStrength: 0.5 } });
    expect(infill).toMatchObject({ operation: "inpainting", strength: 0.5 });
    expect(affCost(infill!)).toBe(80);
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
