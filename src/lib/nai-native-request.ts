const DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

const modelAliases: Record<string, string> = {
  "nai-v4.5-full": "nai-diffusion-4-5-full",
  "nai-v4.5-curated": "nai-diffusion-4-5-curated",
  "nai-v4.5-inpaint": "nai-diffusion-4-5-full-inpainting",
  "nai-v5-full": "nai-diffusion-5-full",
  "nai-v5-curated": "nai-diffusion-5-curated",
  "nai-v5-inpaint": "nai-diffusion-5-inpainting",
  "nai-v4-full": "nai-diffusion-4-full",
  "nai-v4-curated": "nai-diffusion-4-curated-preview",
  "nai-v3": "nai-diffusion-3",
  "nai-v3-inpaint": "nai-diffusion-3-inpainting",
  "nai-v3-furry": "nai-diffusion-furry-3",
  "nai-v3-furry-inpaint": "nai-diffusion-furry-3-inpainting",
};

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

function actionFor(operation: string): string {
  if (operation === "img2img") return "img2img";
  if (operation === "inpainting" || operation === "edits") return "infill";
  return "generate";
}

function characterCaptions(characters: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(characters)) return [];
  return characters.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const prompt = typeof record.prompt === "string" ? record.prompt : "";
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
  const parameters: Record<string, unknown> = {
    params_version: 3,
    width: body.width,
    height: body.height,
    scale: body.scale ?? 5,
    sampler: body.sampler ?? "k_euler_ancestral",
    steps: body.steps ?? 28,
    n_samples: samples,
    ucPreset: 0,
    qualityToggle: true,
    cfg_rescale: body.cfg_rescale ?? 0,
    noise_schedule: body.noise_schedule ?? "karras",
    noise: body.noise ?? 0,
    seed: body.seed ?? 0,
    negative_prompt: negative,
    legacy: false,
    add_original_image: true,
    autoSmea: false,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };
  if (options.stream) parameters.stream = "msgpack";
  if (typeof body.strength === "number") parameters.strength = body.strength;
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
    parameters.reference_image_multiple = stripDataUrl(body.reference_images);
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
  if (Array.isArray(body.characters) && body.characters.length) {
    parameters.characterPrompts = body.characters;
  }
  if (Array.isArray(body.characterPrompts) && body.characterPrompts.length) {
    parameters.characterPrompts = body.characterPrompts;
    const captions = characterCaptions(body.characterPrompts);
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: captions },
      use_coords: true,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: {
        base_caption: negative,
        char_captions: captions.map((item) => ({
          ...item,
          char_caption: "",
        })),
      },
      legacy_uc: false,
    };
  }
  return {
    input: prompt,
    model: naiUpstreamModel(String(body.model || "")),
    action: actionFor(operation),
    parameters,
  };
}
