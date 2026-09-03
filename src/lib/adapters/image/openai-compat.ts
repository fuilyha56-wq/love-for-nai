/**
 * OpenAI 兼容图像适配器
 * 支持 OpenAI 标准图像生成接口（包括 gateway 和其他兼容服务）
 */

import type { ImageAdapter, ImageGenerationRequest, ImageGenerationResponse, EndpointConfig } from "../types";

export function createOpenAICompatImageAdapter(config: EndpointConfig): ImageAdapter {
  const baseUrl = config.config.baseUrl?.replace(/\/+$/, "") || "";
  const token = config.config.token || "";

  return {
    type: "openai_compat",
    name: config.name,

    async generate(request: ImageGenerationRequest, userToken?: string) {
      const payload: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        n: request.samples,
        size: `${request.width}x${request.height}`,
        response_format: "b64_json",
      };

      if (request.negativePrompt) payload.negative_prompt = request.negativePrompt;
      if (request.steps) payload.steps = request.steps;
      if (request.strength !== undefined) payload.strength = request.strength;
      if (request.seed !== undefined) payload.seed = request.seed;
      if (request.operation && request.operation !== "generate") {
        payload.novelai_operation = request.operation === "img2img" ? "img2img" : request.operation;
      }
      if (request.referenceImages?.length) {
        payload.reference_images = request.referenceImages;
      }
      if (request.characterPrompts?.length) {
        payload.characterPrompts = request.characterPrompts;
      }
      if (request.extra) {
        Object.assign(payload, request.extra);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken || token}`,
      };

      const response = await fetch(`${baseUrl}/v1/images/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: "图像生成失败" } }));
        throw new Error(error.error?.message || error.message || "图像生成失败");
      }

      const result = await response.json();
      return {
        images: Array.isArray(result.data)
          ? result.data.map((item: any) => ({
              url: item.url,
              b64_json: item.b64_json,
            }))
          : [],
        usage: result.usage,
      };
    },

    async listModels() {
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) return [];
        const result = await response.json();
        return Array.isArray(result.data)
          ? result.data.map((model: any) => ({
              id: model.id,
              name: model.id,
              capabilities: model.capabilities || ["generate"],
            }))
          : [];
      } catch {
        return [];
      }
    },

    async estimateCost(request: ImageGenerationRequest) {
      // 简化计费：基于像素数和张数
      const pixels = request.width * request.height;
      const baseCost = (pixels / 1024 / 1024) * request.samples;
      return baseCost;
    },
  };
}
