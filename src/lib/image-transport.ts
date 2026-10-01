import sharp from "sharp";
import { ImageRequestValidationError, MAX_IMAGE_BODY_BYTES, normalizeDimension, normalizeSteps, validateImageShape, validateReferenceCount } from "@/lib/image-request";
import { nearestImageAspectRatio, normalizeImageModelSize, resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";

export type ImageTransportRequest = { path: string; headers: Record<string, string>; body: string | FormData; width: number; height: number };
export type ImageTransportResult = { images: string[]; usage: unknown; text: string };
type Raster = { mime: "image/png" | "image/jpeg" | "image/webp"; data: string; bytes: Buffer; label: string };
const invalid = (message: string): never => { throw new ImageRequestValidationError(message); };
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const pngUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString("base64")}`;
const MAX_INPUT_PIXELS = 4096 * 4096;
const stripInlineImagePrefixes = (value: unknown): unknown => {
  if (typeof value === "string") return value.replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "");
  if (Array.isArray(value)) return value.map(stripInlineImagePrefixes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripInlineImagePrefixes(item)]));
  return value;
};

/** Only inline raster inputs are accepted; input URLs cannot cause an authenticated server fetch. */
export function inlineRaster(value: unknown, label = "图片"): Raster {
  const raw = text(value);
  const match = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  const data = (match?.[2] ?? raw).replace(/[\r\n]/g, "");
  if (!data || data.length > MAX_IMAGE_BODY_BYTES * 4 / 3 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) invalid(`${label}必须是 PNG、JPEG 或 WebP 的 base64 数据`);
  const bytes = Buffer.from(data, "base64");
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime || (match && match[1].toLowerCase() !== mime)) return invalid(`${label}的格式与图片内容不一致`);
  return { mime, bytes, data: bytes.toString("base64"), label };
}

export function collectImageInputs(body: Record<string, unknown>): Raster[] {
  const inputs: Raster[] = [];
  const add = (value: unknown, label: string) => { if (text(value)) inputs.push(inlineRaster(value, label)); };
  add(body.image, "待编辑原图");
  add(body.reference_image, "风格参考图");
  if (Array.isArray(body.reference_images)) body.reference_images.forEach((value, i) => add(value, `风格参考 ${i + 1}`));
  if (Array.isArray(body.references)) body.references.forEach((value, i) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    add(item.reference_image ?? item.image, `${text(item.reference_type) || "主体"}参考 ${i + 1}`);
  });
  if (Array.isArray(body.characters)) body.characters.forEach((value, i) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    add(item.image ?? item.reference_image, `角色参考 ${i + 1}`);
  });
  validateReferenceCount(inputs.length - (text(body.image) ? 1 : 0));
  if (inputs.reduce((sum, input) => sum + input.bytes.length, 0) > MAX_IMAGE_BODY_BYTES) invalid("输入图片总大小超过 25 MiB");
  return inputs;
}

const OPERATION_INSTRUCTIONS: Record<string, string> = {
  img2img: "Edit the first input image according to the description. Preserve its composition and subject identity unless the description requests changes.",
  edits: "Edit the first input image according to the description, preserving all unspecified details.",
  inpainting: "Edit only the masked region of the first input image. Preserve every unmasked pixel and the original composition.",
  outpainting: "Extend the first input image into the blank masked region. Preserve the existing image and seamlessly continue its scene.",
  "vibe-transfer": "Create an image following the description and use the attached reference images for visual style, colors, lighting and atmosphere.",
  "character-reference": "Create an image following the description. Preserve the identity, facial features and clothing of the subjects in the character reference images.",
  "precise-reference": "Create an image following the description. Use the labeled reference images for the specified subject identity and style.",
  "director-declutter": "Remove visual clutter and unwanted distractions from the first image while preserving its main subject and composition.",
  "director-bg-remover": "Remove the background from the first image. Preserve the subject and its fine edges. Return a transparent background where supported, otherwise a plain white background.",
  "director-lineart": "Convert the first image into clean black line art on a white background, preserving its contours and composition.",
  "director-sketch": "Convert the first image into a clean pencil sketch, preserving its contours and composition.",
  "director-colorize": "Colorize the first image following the description. Preserve its existing outlines, composition and subject identity.",
  "director-emotion": "Change only the facial expression of the subject in the first image to the requested emotion. Preserve identity, pose, clothing and background.",
  upscale: "Restore and enhance fine detail in the first image. Preserve its composition, colors and all objects. Do not add or remove subjects, text or scenery.",
};

export function imageInstructionPrompt(body: Record<string, unknown>, inputs: readonly { label: string }[] = []): string {
  const operation = text(body.operation) || "generate";
  const parts = [OPERATION_INSTRUCTIONS[operation], text(body.prompt)].filter(Boolean);
  if (operation === "director-emotion" && text(body.emotion)) parts.push(`Requested emotion: ${text(body.emotion)}.`);
  const negative = text(body.negative_prompt) || text(body.negativePrompt);
  if (negative) parts.push(`Avoid including the following: ${negative}.`);
  if (typeof body.strength === "number" && Number.isFinite(body.strength) && operation === "img2img") parts.push(`Requested degree of change: ${Math.round(Math.max(0, Math.min(1, body.strength)) * 100)}% (a visual instruction, not a diffusion parameter).`);
  if (Array.isArray(body.characterPrompts)) {
    for (const [i, value] of body.characterPrompts.entries()) {
      if (!value || typeof value !== "object") continue;
      const character = value as Record<string, unknown>;
      if (!text(character.prompt)) continue;
      let instruction = `Character ${i + 1}: ${text(character.prompt)}.`;
      const center = character.center && typeof character.center === "object" ? character.center as Record<string, unknown> : {};
      if (body.use_coords !== false && typeof center.x === "number" && typeof center.y === "number" && Number.isFinite(center.x) && Number.isFinite(center.y)) instruction += ` Position its center at ${Math.round(Math.max(0, Math.min(1, center.x)) * 100)}% of image width and ${Math.round(Math.max(0, Math.min(1, center.y)) * 100)}% of image height.`;
      const avoid = text(character.negativePrompt) || text(character.negative);
      if (avoid) instruction += ` For this character avoid: ${avoid}.`;
      parts.push(instruction);
    }
  }
  if (inputs.length) parts.push(`Input images in order: ${inputs.map((input, i) => `${i + 1}: ${input.label}`).join("; ")}.`);
  if (typeof body.reference_strength === "number" && Number.isFinite(body.reference_strength)) parts.push(`Reference style influence: ${Math.round(Math.max(0, Math.min(1, body.reference_strength)) * 100)}% (visual guidance).`);
  if (Array.isArray(body.references)) body.references.forEach((value, index) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const strength = typeof item.strength === "number" && Number.isFinite(item.strength) ? ` Influence ${Math.round(Math.max(0, Math.min(1, item.strength)) * 100)}%.` : "";
    const fidelity = typeof item.fidelity === "number" && Number.isFinite(item.fidelity) ? ` Identity/detail fidelity ${Math.round(Math.max(0, Math.min(1, item.fidelity)) * 100)}%.` : "";
    if (strength || fidelity) parts.push(`Reference ${index + 1}.${strength}${fidelity}`);
  });
  if (text(body.mask)) parts.push("The mask marks editable areas in white and protected areas in black; where supplied as a native alpha mask, transparent areas are editable.");
  return parts.join("\n\n");
}

async function rasterMetadata(input: Raster) {
  try {
    const metadata = await sharp(input.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) invalid("图片尺寸无效或使用了不支持的动态图像");
    return { width: metadata.width, height: metadata.height };
  } catch (error) { if (error instanceof ImageRequestValidationError) throw error; return invalid("图片无法解码或尺寸超过 4096×4096"); }
}

export async function imageTransportOutputDimensions(image: string): Promise<{ width: number; height: number } | null> {
  try { return await rasterMetadata(inlineRaster(image)); } catch { return null; }
}

/** LFN/NAI masks are white=edit; GPT Images requires alpha=0 for those same pixels. */
export async function openAiAlphaMask(maskValue: unknown, imageValue: unknown): Promise<Buffer> {
  const mask = inlineRaster(maskValue, "蒙版");
  const source = inlineRaster(imageValue, "待编辑原图");
  const dims = await rasterMetadata(source);
  const maskDims = await rasterMetadata(mask);
  if (dims.width !== maskDims.width || dims.height !== maskDims.height) invalid("蒙版尺寸必须与原图一致");
  const { data, info } = await sharp(mask.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const amount = Math.round((data[offset] + data[offset + 1] + data[offset + 2]) / 3 * data[offset + 3] / 255);
    data[offset] = data[offset + 1] = data[offset + 2] = 0;
    data[offset + 3] = 255 - amount;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export async function buildImageTransportRequest(body: Record<string, unknown>, apiKey: string, protocol: ImageProviderProtocol = "auto", samples = 1): Promise<ImageTransportRequest> {
  const model = text(body.model);
  const capabilities = resolveImageModelCapabilities(model, protocol);
  const operation = text(body.operation) || "generate";
  if (!capabilities.operations.includes(operation)) invalid(`模型 ${model} 不支持此操作：${operation}`);
  const inputs = collectImageInputs(body);
  for (const input of inputs) await rasterMetadata(input);
  const hasMask = Boolean(text(body.mask));
  let maskedDimensions: { width: number; height: number } | null = null;
  if (hasMask && !text(body.image)) invalid("重绘蒙版需要同时提供原图");
  if (hasMask) {
    const mask = inlineRaster(body.mask, "蒙版");
    const [maskDims, imageDims] = await Promise.all([rasterMetadata(mask), rasterMetadata(inputs[0])]);
    if (maskDims.width !== imageDims.width || maskDims.height !== imageDims.height) invalid("蒙版尺寸必须与原图一致");
    maskedDimensions = imageDims;
    if (mask.bytes.length + inputs.reduce((sum, input) => sum + input.bytes.length, 0) > MAX_IMAGE_BODY_BYTES) invalid("输入图片和蒙版总大小超过 25 MiB");
  }
  if ((operation.startsWith("director-") || ["img2img", "edits", "inpainting", "outpainting", "upscale"].includes(operation)) && !text(body.image)) invalid("请先上传待编辑图片");
  if (["inpainting", "outpainting"].includes(operation) && !hasMask) invalid("请先绘制编辑蒙版");
  if (["vibe-transfer", "character-reference", "precise-reference"].includes(operation) && !inputs.length) invalid("请先添加参考图片");
  let width = maskedDimensions?.width ?? Number(body.width ?? 1024);
  let height = maskedDimensions?.height ?? Number(body.height ?? 1024);
  if (operation === "upscale") {
    const dims = await rasterMetadata(inputs[0]);
    width = dims.width * 2;
    height = dims.height * 2;
  }
  if (![width, height].every((dimension) => Number.isSafeInteger(dimension) && dimension >= 64 && dimension <= 4096) || width * height > MAX_INPUT_PIXELS) invalid("图像尺寸必须在 64-4096 之间，且不能超过 4096×4096 像素");
  if (!inputs.length && !text(body.prompt)) invalid("请输入图像描述");
  let prompt = capabilities.family === "nai" ? text(body.prompt) : imageInstructionPrompt(body, inputs);
  if (capabilities.protocol === "openai-chat-images") prompt += `\n\nRequested output aspect ratio: ${width}:${height}.`;
  if (capabilities.family !== "nai" && (body.background === "transparent" || body.transparent === true)) prompt += "\nUse a transparent background where supported.";
  if (capabilities.family !== "nai" && body.background === "opaque") prompt += "\nUse an opaque background.";
  const dimensions = { width, height };
  const auth = { Authorization: `Bearer ${apiKey}` };
  if (capabilities.protocol === "gemini") {
    const geminiModel = model.replace(/^models\//, "");
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(geminiModel)) invalid("Gemini 原生模型 ID 格式无效");
    const parts: Record<string, unknown>[] = [{ text: prompt }];
    inputs.forEach((input) => parts.push({ inlineData: { mimeType: input.mime, data: input.data } }));
    if (hasMask) { const mask = inlineRaster(body.mask, "编辑蒙版（白色为编辑区）"); await rasterMetadata(mask); parts.push({ text: "Final image is the edit mask: white means edit, black means preserve." }, { inlineData: { mimeType: mask.mime, data: mask.data } }); }
    const imageConfig: Record<string, unknown> = { aspectRatio: nearestImageAspectRatio(width, height, capabilities.aspectRatios) };
    const imageSize = text(body.imageSize) || text(body.image_size);
    if (imageSize) {
      const allowed = capabilities.imageSizes;
      if (!allowed.includes(imageSize)) invalid(`模型 ${model} 不支持所选输出分辨率`);
      if (allowed.length > 1) imageConfig.imageSize = imageSize;
    }
    return { path: `/v1beta/models/${geminiModel}:generateContent`, headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig } }), ...dimensions };
  }
  if (capabilities.protocol === "openai-chat-images") {
    const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
    inputs.forEach((input) => content.push({ type: "image_url", image_url: { url: `data:${input.mime};base64,${input.data}` } }));
    if (hasMask) { const mask = inlineRaster(body.mask, "编辑蒙版"); await rasterMetadata(mask); content.push({ type: "text", text: "Final image is the edit mask: white means edit, black means preserve." }, { type: "image_url", image_url: { url: `data:${mask.mime};base64,${mask.data}` } }); }
    return { path: "/v1/chat/completions", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content }], modalities: ["text", "image"], stream: false }), ...dimensions };
  }
  if (capabilities.family === "nai") {
    normalizeDimension(width, "width");
    normalizeDimension(height, "height");
    validateImageShape(width, height);
    const steps = normalizeSteps(body.steps);
    const allowed = ["prompt", "negative_prompt", "negativePrompt", "scale", "sampler", "noise_schedule", "cfg_rescale", "seed", "strength", "noise", "image", "mask", "reference_image", "reference_images", "references", "characters", "characterPrompts", "use_coords", "reference_strength", "reference_information_extracted", "qualityToggle", "ucPreset", "emotion", "defry"];
    const payload: Record<string, unknown> = { model, ...Object.fromEntries(allowed.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])), width, height, steps, n: samples, n_samples: samples, response_format: "b64_json" };
    for (const field of ["image", "mask", "reference_image", "reference_images", "references", "characters"]) if (payload[field] !== undefined) payload[field] = stripInlineImagePrefixes(payload[field]);
    if (operation !== "generate") payload.novelai_operation = operation === "outpainting" ? "inpainting" : operation;
    return { path: "/v1/images/generations", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(payload), ...dimensions };
  }
  const outputSize = normalizeImageModelSize(model, width, height, protocol);
  const options: Record<string, string | number> = { model, prompt, n: samples, size: `${outputSize.width}x${outputSize.height}` };
  if (capabilities.family === "gpt-image") {
    const quality = text(body.quality);
    if (quality) { if (!capabilities.qualityOptions.includes(quality)) invalid("GPT 图像质量选项无效"); options.quality = quality; }
    options.output_format = "png";
    const background = text(body.background);
    if (background && !["auto", "opaque", "transparent"].includes(background)) invalid("GPT 图像背景选项无效");
    if (background) options.background = background;
    if (body.transparent === true || operation === "director-bg-remover") options.background = "transparent";
  } else options.response_format = "b64_json";
  if (inputs.length) {
    if (!capabilities.edit) invalid(`模型 ${model} 不支持图片编辑或参考图片`);
    if (/^dall-e-2$/i.test(model) && inputs.length > 1) invalid("DALL·E 2 只支持一张编辑原图");
    if (/^dall-e-2$/i.test(model)) { const inputSize = await rasterMetadata(inputs[0]); if (inputs[0].mime !== "image/png" || inputSize.width !== inputSize.height || inputs[0].bytes.length >= 4 * 1024 * 1024) invalid("DALL·E 2 编辑原图必须是小于 4 MiB 的正方形 PNG"); }
    const form = new FormData();
    Object.entries(options).forEach(([key, value]) => form.set(key, String(value)));
    inputs.forEach((input, i) => form.append(capabilities.family === "gpt-image" ? "image[]" : "image", new Blob([new Uint8Array(input.bytes)], { type: input.mime }), `input-${i + 1}.${input.mime.split("/")[1]}`));
    if (hasMask && capabilities.nativeMask) form.set("mask", new Blob([new Uint8Array(await openAiAlphaMask(body.mask, body.image))], { type: "image/png" }), "mask.png");
    else if (hasMask) { const mask = inlineRaster(body.mask, "编辑蒙版"); form.append("image[]", new Blob([new Uint8Array(mask.bytes)], { type: mask.mime }), "mask-reference.png"); }
    return { path: "/v1/images/edits", headers: auth, body: form, ...(hasMask || operation === "upscale" ? dimensions : outputSize) };
  }
  return { path: "/v1/images/generations", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(options), ...outputSize };
}

function validImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? value : null; } catch { return null; }
}

export function parseImageTransportResult(result: Record<string, unknown>): ImageTransportResult {
  const images: string[] = [];
  const texts: string[] = [];
  const add = (value: unknown) => { const url = validImageUrl(value); if (url) images.push(url); };
  if (Array.isArray(result.data)) result.data.forEach((value) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (typeof item.b64_json === "string" && /^[A-Za-z0-9+/=\r\n]+$/.test(item.b64_json)) images.push(`data:image/${result.output_format === "jpeg" ? "jpeg" : result.output_format === "webp" ? "webp" : "png"};base64,${item.b64_json}`);
    else add(item.url);
  });
  if (Array.isArray(result.candidates)) result.candidates.forEach((value) => {
    const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const content = candidate.content && typeof candidate.content === "object" ? candidate.content as Record<string, unknown> : {};
    if (!Array.isArray(content.parts)) return;
    content.parts.forEach((value) => {
      const part = value && typeof value === "object" ? value as Record<string, unknown> : {};
      if (part.thought === true) return;
      const inline = (part.inlineData ?? part.inline_data) as Record<string, unknown> | undefined;
      if (inline && typeof inline.data === "string") add(`data:${inline.mimeType ?? inline.mime_type};base64,${inline.data}`);
      if (typeof part.text === "string") texts.push(part.text);
    });
  });
  if (Array.isArray(result.choices)) result.choices.forEach((value) => {
    const choice = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const message = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
    const parts = [...(Array.isArray(message.images) ? message.images : []), ...(Array.isArray(message.content) ? message.content : [])];
    parts.forEach((value) => {
      const part = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const nested = (part.image_url ?? part.imageUrl) as Record<string, unknown> | string | undefined;
      add(typeof nested === "string" ? nested : nested?.url);
      if (typeof part.text === "string") texts.push(part.text);
    });
    if (typeof message.content === "string") {
      texts.push(message.content);
      for (const match of message.content.matchAll(/!\[[^\]]*\]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+)\)/g)) add(match[1]);
    }
  });
  return { images, usage: result.usage ?? result.usageMetadata ?? null, text: texts.join("\n") };
}

/** Restore protected pixels after every masked edit, including providers without a native mask. */
export async function finishImageTransportImages(body: Record<string, unknown>, images: string[]): Promise<string[]> {
  if (!text(body.mask) && body.operation !== "upscale") return images;
  const source = inlineRaster(body.image, "待编辑原图");
  const dimensions = await rasterMetadata(source);
  if (body.operation === "upscale") return Promise.all(images.map(async (image) => {
    const generated = inlineRaster(image, "上游图片");
    return pngUrl(await sharp(generated.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).resize(dimensions.width * 2, dimensions.height * 2).png().toBuffer());
  }));
  const mask = inlineRaster(body.mask, "蒙版");
  const maskDims = await rasterMetadata(mask);
  if (dimensions.width !== maskDims.width || dimensions.height !== maskDims.height) invalid("蒙版尺寸必须与原图一致");
  const original = await sharp(source.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().raw().toBuffer();
  const maskPixels = await sharp(mask.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().raw().toBuffer();
  return Promise.all(images.map(async (image) => {
    const generated = inlineRaster(image, "上游重绘图片");
    const output = await sharp(generated.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).resize(dimensions.width, dimensions.height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    for (let offset = 0; offset < output.length; offset += 4) {
      const weight = (maskPixels[offset] + maskPixels[offset + 1] + maskPixels[offset + 2]) / (3 * 255) * maskPixels[offset + 3] / 255;
      for (let channel = 0; channel < 4; channel++) output[offset + channel] = Math.round(original[offset + channel] * (1 - weight) + output[offset + channel] * weight);
    }
    return pngUrl(await sharp(output, { raw: { ...dimensions, channels: 4 } }).png().toBuffer());
  }));
}
