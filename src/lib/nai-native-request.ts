const DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;
const NAI_SEED_RANGE = 2 ** 32;

export const NAI_MEDIUM_NEGATIVE_PROMPT = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";

const modelAliases: Record<string, string> = {
  "nai-v4.5-full": "nai-diffusion-4-5-full",
  "nai-v4.5-curated": "nai-diffusion-4-5-curated",
  "nai-v4.5-inpaint": "nai-diffusion-4-5-full-inpainting",
  "nai-v4.5-curated-inpaint": "nai-diffusion-4-5-curated-inpainting",
  "nai-v5-full": "nai-diffusion-5-full",
  "nai-v5-curated": "nai-diffusion-5-curated",
  "nai-v5-inpaint": "nai-diffusion-5-full-inpainting",
  "nai-v5-full-medium": "nai-diffusion-5-full-medium",
  "nai-v5-inpaint-medium": "nai-diffusion-5-full-medium-inpainting",
  "nai-v4-full": "nai-diffusion-4-full",
  "nai-v4-curated": "nai-diffusion-4-curated-preview",
  "nai-v3": "nai-diffusion-3",
  "nai-v3-inpaint": "nai-diffusion-3-inpainting",
  "nai-v3-furry": "nai-diffusion-furry-3",
  "nai-v3-furry-inpaint": "nai-diffusion-furry-3-inpainting",
};

export function naiUsageModel(model: string): string {
  const normalized = model.trim().toLowerCase().replace(/-limit(?=-|$)/g, "");
  if (normalized === "nai-diffusion-5") return "nai-v5-full";
  if (normalized === "nai-diffusion-5-inpainting") return "nai-v5-inpaint";
  return Object.entries(modelAliases).find(([, native]) => native === normalized)?.[0] || normalized;
}

export function stripDataUrl(value: unknown): unknown {
  if (typeof value === "string")
    return DATA_URL.test(value) ? value.replace(DATA_URL, "") : value;
  if (Array.isArray(value)) return value.map(stripDataUrl);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        stripDataUrl(item),
      ]),
    );
  return value;
}

export function naiUpstreamModel(model: string): string {
  const trimmed = model.trim();
  const withoutLimit = trimmed.replace(/-limit$/i, "");
  return modelAliases[withoutLimit] || trimmed;
}

/** These billing aliases are absent from the Gateway registry. Pass-through
 * NewAPI channels skip model_mapping, so send their official IDs directly. */
export function naiGatewayModel(model: string): string {
  return ["nai-v4.5-curated-inpaint", "nai-v4-full", "nai-v4-curated"].includes(model)
    ? naiUpstreamModel(model)
    : model;
}

export function isNaiMediumModel(model: string): boolean {
  return /nai-v5-(?:full|inpaint)-medium$/i.test(model) ||
    /nai-diffusion-5-full-medium(?:-inpainting)?$/i.test(model);
}

/** Older OpenAI-compatible NAI gateways append quality_tags independently of
 * qualityToggle. Send both opt-outs so composed/custom/disabled presets survive
 * buffering and stream fallback without an extra default suffix. */
export function naiGatewayGenerationBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    ...(typeof body.model === "string" ? { model: naiGatewayModel(body.model) } : {}),
    ...(body.qualityToggle === false ? { quality_tags: "" } : {}),
  };
}

export function randomNaiSeed(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject) {
    const bytes = new Uint32Array(1);
    cryptoObject.getRandomValues(bytes);
    return bytes[0] || 1;
  }
  return Math.floor(Math.random() * (NAI_SEED_RANGE - 1)) + 1;
}

function actionFor(operation: string): string {
  if (operation === "img2img") return "img2img";
  if (["inpainting", "infill", "edits", "outpainting"].includes(operation)) return "infill";
  return "generate";
}

function modelForAction(model: string, action: string): string {
  const upstream = naiUpstreamModel(model);
  if (action !== "infill") return upstream;
  if (upstream.endsWith("-inpainting")) return upstream;
  if (isNaiMediumModel(model)) return "nai-diffusion-5-full-medium-inpainting";
  if (upstream.startsWith("nai-diffusion-5"))
    return "nai-diffusion-5-full-inpainting";
  if (upstream.startsWith("nai-diffusion-4-5"))
    return "nai-diffusion-4-5-full-inpainting";
  return upstream;
}

function characterCaptions(characters: unknown, negative = false): Array<Record<string, unknown>> {
  if (!Array.isArray(characters)) return [];
  return characters.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const prompt = negative
      ? typeof record.negativePrompt === "string"
        ? record.negativePrompt
        : typeof record.negative === "string"
          ? record.negative
          : ""
      : typeof record.prompt === "string" ? record.prompt : "";
    const center =
      record.center && typeof record.center === "object"
        ? (record.center as Record<string, unknown>)
        : {};
    return [
      {
        char_caption: prompt,
        centers: [
          {
            x: typeof center.x === "number" ? center.x : 0.5,
            y: typeof center.y === "number" ? center.y : 0.5,
          },
        ],
      },
    ];
  });
}

export function naiNativeGenerationBody(
  body: Record<string, unknown>,
  options: { stream?: boolean; samples?: number } = {},
): Record<string, unknown> {
  const operation = typeof body.operation === "string" ? body.operation : "generate";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const negative =
    typeof body.negative_prompt === "string"
      ? body.negative_prompt
      : typeof body.negativePrompt === "string"
        ? body.negativePrompt
        : "";
  const samples = options.samples ?? (typeof body.n === "number" ? body.n : 1);
  // 角色定位模式：use_coords=false 时由 AI 根据提示词决定位置（Aaalice aiChoice）。
  const useCoords = typeof body.use_coords === "boolean" ? body.use_coords : true;
  const action = actionFor(operation);
  const upstreamModel = modelForAction(String(body.model || ""), action);
  const medium = isNaiMediumModel(String(body.model || ""));
  const parameters: Record<string, unknown> = {
    params_version: upstreamModel.startsWith("nai-diffusion-5") ? 4 : 3,
    width: body.width,
    height: body.height,
    scale: body.scale ?? 5,
    sampler: medium ? "k_euler_ancestral" : body.sampler ?? "k_euler_ancestral",
    steps: medium ? 14 : body.steps ?? 28,
    n_samples: samples,
    ucPreset: typeof body.ucPreset === "number" && Number.isInteger(body.ucPreset) && body.ucPreset >= 0 && body.ucPreset <= 3 ? body.ucPreset : 0,
    qualityToggle: typeof body.qualityToggle === "boolean" ? body.qualityToggle : true,
    cfg_rescale: medium ? 0 : body.cfg_rescale ?? 0,
    noise_schedule: body.noise_schedule ?? "karras",
    noise: body.noise ?? 0,
    // NAI 官方语义：种子留空即随机；0 同样视为未指定。
    seed: typeof body.seed === "number" && Number.isSafeInteger(body.seed) && body.seed !== 0 ? body.seed : randomNaiSeed(),
    negative_prompt: medium ? NAI_MEDIUM_NEGATIVE_PROMPT : negative,
    legacy: false,
    add_original_image: true,
    autoSmea: false,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };
  if (medium) {
    parameters.ucPreset = 0;
    parameters.tag_hint_uc_preset = 2;
  }
  if (options.stream) parameters.stream = "msgpack";
  if (typeof body.strength === "number" || action === "img2img")
    parameters.strength = typeof body.strength === "number" ? body.strength : 0.7;
  if (typeof body.inpaintImg2ImgStrength === "number" || action === "infill")
    parameters.inpaintImg2ImgStrength = typeof body.inpaintImg2ImgStrength === "number"
      ? body.inpaintImg2ImgStrength
      : typeof body.strength === "number" ? body.strength : 1;
  if (typeof body.uncond_scale === "number") parameters.uncond_scale = body.uncond_scale;
  if (typeof body.service_tier === "string") parameters.service_tier = body.service_tier;
  if (typeof body.image === "string" && body.image)
    parameters.image = stripDataUrl(body.image);
  if (typeof body.mask === "string" && body.mask)
    parameters.mask = stripDataUrl(body.mask);
  if (typeof body.reference_image === "string" && body.reference_image) {
    parameters.reference_image_multiple = [stripDataUrl(body.reference_image)];
    parameters.reference_strength_multiple = [
      typeof body.reference_strength === "number" ? body.reference_strength : 0.6,
    ];
    parameters.reference_information_extracted_multiple = [
      typeof body.reference_information_extracted === "number"
        ? body.reference_information_extracted
        : 1,
    ];
  }
  if (Array.isArray(body.reference_images) && body.reference_images.length) {
    {
      parameters.reference_image_multiple = stripDataUrl(body.reference_images);
      parameters.reference_strength_multiple = body.reference_images.map((_, index) => Array.isArray(body.reference_strength_multiple) ? body.reference_strength_multiple[index] ?? 0.6 : 0.6);
      parameters.reference_information_extracted_multiple = body.reference_images.map((_, index) => Array.isArray(body.reference_information_extracted_multiple) ? body.reference_information_extracted_multiple[index] ?? 1 : 1);
    }
  }
  // The studio's character-reference operation wraps each uploaded image in
  // characters[].reference_image. Native NAI accepts these in the same
  // reference-image fields as other reference operations.
  if (operation === "character-reference" && Array.isArray(body.characters)) {
    const characters = body.characters.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
    );
    const references = characters
      .map((character) => character.reference_image)
      .filter((image): image is string => typeof image === "string" && image.length > 0);
    if (references.length) {
      parameters.reference_image_multiple = stripDataUrl(references);
      parameters.reference_strength_multiple = characters
        .filter((character) => typeof character.reference_image === "string" && character.reference_image.length > 0)
        .map((character) => typeof character.reference_strength === "number" ? character.reference_strength : 0.6);
      parameters.reference_information_extracted_multiple = characters
        .filter((character) => typeof character.reference_image === "string" && character.reference_image.length > 0)
        .map((character) => typeof character.reference_information_extracted === "number" ? character.reference_information_extracted : 1);
    }
  }
  if (Array.isArray(body.references) && body.references.length) {
    parameters.director_reference_images = (body.references as Array<Record<string, unknown>>)
      .map((item) => stripDataUrl(item.reference_image))
      .filter(Boolean);
    parameters.director_reference_descriptions = (body.references as Array<Record<string, unknown>>).map(
      (item) => ({
        caption: {
          base_caption: String(item.reference_type || "character"),
          char_captions: [],
        },
        legacy_uc: false,
      }),
    );
    parameters.director_reference_information_extracted = (
      body.references as Array<Record<string, unknown>>
    ).map((item) => (typeof item.fidelity === "number" ? item.fidelity : 1));
    parameters.director_reference_strength_values = (
      body.references as Array<Record<string, unknown>>
    ).map((item) => (typeof item.strength === "number" ? item.strength : 1));
  }
  if (Array.isArray(body.characterPrompts) && body.characterPrompts.length) {
    parameters.characterPrompts = medium
      ? (body.characterPrompts as Array<Record<string, unknown>>).map((character) => ({ ...character, negative: "", negativePrompt: "" }))
      : body.characterPrompts;
    const captions = characterCaptions(body.characterPrompts);
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: captions },
      use_coords: useCoords,
      use_order: true,
    };
    // 每角色负向：优先 negativePrompt，并兼容旧 negative 字段。
    parameters.v4_negative_prompt = {
      caption: {
        base_caption: medium ? NAI_MEDIUM_NEGATIVE_PROMPT : negative,
        char_captions: characterCaptions(parameters.characterPrompts, true),
      },
      legacy_uc: false,
    };
  }
  return {
    input: prompt,
    model: upstreamModel,
    action,
    parameters,
  };
}
