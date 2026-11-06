import { decode, encode } from "@msgpack/msgpack";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { detectWatermarkImageMime, watermarkImages, WatermarkSigningError, type WatermarkOptions } from "./image-watermark";
import { getRuntimeSettings } from "./runtime-config";

const DATA_URL = /^data:image\/[\w.+-]+;base64,/i;

export function imageWatermarkErrorResponse(headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("X-LFN-Watermark", "failed");
  const message = "图片来源签名失败，本次未交付未签名图片";
  return NextResponse.json({ message, error: { message, type: "api_error", code: "lfn_image_watermark_failed" } }, { status: 502, headers: responseHeaders });
}

export type ImageWatermarkStatus =
  "embedded" | "disabled" | "skipped" | "failed";
export type ImageStreamWatermarkResult = { samples: number; status: ImageWatermarkStatus; error?: string };
function responseWithBody(
  source: Response,
  body: BodyInit | ReadableStream<Uint8Array>,
  status: string,
  type?: string,
) {
  const headers = new Headers(source.headers);
  for (const key of [
    "content-length",
    "content-encoding",
    "content-range",
    "content-md5",
    "digest",
    "etag",
  ])
    headers.delete(key);
  headers.set("X-LFN-Watermark", status);
  if (type) headers.set("content-type", type);
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/** Sign completed images in their existing response envelope. */
export async function watermarkImageResponse(
  source: Response,
  userId: number,
  model: string,
  options: WatermarkOptions & {
    expectImage?: boolean;
    octetStreamIsMsgpack?: boolean;
    onSseComplete?: (result: ImageStreamWatermarkResult) => Promise<void>;
  } = {},
): Promise<{ response: Response; status: () => ImageWatermarkStatus }> {
  let state: ImageWatermarkStatus = "skipped";
  const signedSamples = new Set<number>();
  const merge = (next: ImageWatermarkStatus) => {
    if (state === "failed" || next === "failed") state = "failed";
    else if (next === "embedded" || state === "embedded") state = "embedded";
    else state = next;
  };
  const unchanged = (status: ImageWatermarkStatus) => {
    state = status;
    const headers = new Headers(source.headers);
    headers.set("X-LFN-Watermark", state);
    return {
      response: new Response(source.body, {
        status: source.status,
        statusText: source.statusText,
        headers,
      }),
      status: () => state,
    };
  };
  if (!source.ok) return unchanged("skipped");
  if (!options.required && !(await getRuntimeSettings()).watermarkEnabled)
    return unchanged("disabled");
  const mark = async (bytes: Uint8Array, index: number) => {
    const result = await watermarkImages(
      [`data:${detectWatermarkImageMime(bytes) || "image/png"};base64,${Buffer.from(bytes).toString("base64")}`],
      userId,
      model,
      { ...options, imageId: `${options.requestId || "lfn"}-${index + 1}` },
    );
    merge(result.status);
    if (result.status === "embedded") signedSamples.add(index);
    return new Uint8Array(
      Buffer.from(
        result.images[0].replace(DATA_URL, ""),
        "base64",
      ),
    );
  };
  // Also covers website JSON, OpenAI URL results, and aliases in SSE done/final.
  const markedImages = new Map<string, Promise<string>>();
  const markImage = (image: string, index: number): Promise<string> => {
    const key = `${index}:${image}`;
    let pending = markedImages.get(key);
    if (!pending) {
      pending = watermarkImages([image], userId, model, {
        ...options,
        imageId: `${options.requestId || "lfn"}-${index + 1}`,
      }).then((result) => {
        merge(result.status);
        if (result.status === "embedded") signedSamples.add(index);
        return result.images[0];
      });
      markedImages.set(key, pending);
    }
    return pending;
  };
  const markString = async (image: string, index: number) => {
    const inline = DATA_URL.test(image) || /^https?:\/\//i.test(image);
    const marked = await markImage(inline ? image : `data:image/png;base64,${image}`, index);
    return inline ? marked : marked.replace(DATA_URL, "");
  };
  const markFields = async (item: Record<string, unknown>, index: number, includeUrl: boolean) => {
    const b64 = typeof item.b64_json === "string" && item.b64_json;
    if (b64) {
      const marked = await markImage(DATA_URL.test(b64) ? b64 : `data:image/png;base64,${b64}`, index);
      item.b64_json = marked.replace(DATA_URL, "");
      if (includeUrl && typeof item.url === "string") item.url = marked;
    } else if (includeUrl && typeof item.url === "string" && item.url) {
      item.url = await markString(item.url, index);
    }
    if (typeof item.image === "string" && item.image) item.image = await markString(item.image, index);
  };
  const markItems = async (items: unknown[]) => {
    for (const [index, item] of items.entries()) {
      if (typeof item === "string" && item) items[index] = await markString(item, index);
      else if (item && typeof item === "object") await markFields(item as Record<string, unknown>, index, true);
    }
  };
  const markJson = async (payload: unknown) => {
    if (Array.isArray(payload)) return markItems(payload);
    if (!payload || typeof payload !== "object") return;
    const item = payload as Record<string, unknown>;
    if (Array.isArray(item.data)) await markItems(item.data);
    else if (item.data && typeof item.data === "object") await markFields(item.data as Record<string, unknown>, 0, true);
    if (Array.isArray(item.images)) await markItems(item.images);
    await markFields(item, Number(item.sampleIndex ?? item.sample_index ?? item.samp_ix) || 0, true);
  };
  const type = (source.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/event-stream") && source.body) {
    const decoder = new TextDecoder(),
      encoder = new TextEncoder();
    let pending = "";
    let upstreamFailed = false;
    const frame = async (text: string) => {
      const lines = text.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const finalEvents = ["final", "done", "image_generation.completed"];
      if (event === "error") upstreamFailed = true;
      if (event && event !== "message" && !finalEvents.includes(event)) return text;
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data.trim() === "[DONE]") return text;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(data); }
      catch (error) {
        if (event && finalEvents.includes(event)) throw error;
        return text;
      }
      if (payload?.type === "error" || payload?.event_type === "error") upstreamFailed = true;
      const kind = event && event !== "message" ? event : payload?.type ?? payload?.event_type;
      if (typeof kind !== "string" || !finalEvents.includes(kind)) return text;
      await markJson(payload);
      return [
        ...lines.filter((line) => !line.startsWith("data:")),
        `data: ${JSON.stringify(payload)}`,
      ].join("\n");
    };
    const reader = source.body.getReader();
    const deliveredSamples = new Set<number>();
    let ended = false;
    let cancelled = false;
    let completion: Promise<void> | undefined;
    const finish = (error?: string) => completion ??= options.onSseComplete?.({ samples: deliveredSamples.size, status: state, error }).catch(() => {
      console.error("[lfn] 图像流签名结果结算失败");
    }) ?? Promise.resolve();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          let boundary = pending.indexOf("\n\n");
          while (boundary < 0 && !ended) {
            const { done, value } = await reader.read();
            ended = done;
            pending = (pending + (done ? decoder.decode() : decoder.decode(value, { stream: true }))).replace(/\r\n/g, "\n");
            boundary = pending.indexOf("\n\n");
            if ((boundary < 0 ? pending.length : boundary) > 96_000_000) throw new Error("Image SSE frame too large");
          }
          if (cancelled) return;
          if (boundary < 0 && !pending.trim()) {
            await finish(upstreamFailed ? "上游图片流失败" : options.expectImage && !deliveredSamples.size ? "上游流未返回最终图片" : undefined);
            if (cancelled) return;
            reader.releaseLock();
            controller.close();
            return;
          }
          const text = boundary < 0 ? pending : pending.slice(0, boundary);
          pending = boundary < 0 ? "" : pending.slice(boundary + 2);
          const signedFrame = await frame(text);
          if (cancelled) return;
          controller.enqueue(encoder.encode(signedFrame + "\n\n"));
          for (const sample of signedSamples) deliveredSamples.add(sample);
        } catch {
          // A completed event can contain several images. None were delivered
          // if one failed, but previous successfully sent events still count.
          if (cancelled) return;
          state = "failed";
          await reader.cancel().catch(() => undefined);
          const message = "图片来源签名失败";
          await finish(message);
          if (cancelled) return;
          reader.releaseLock();
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { message, code: "lfn_image_watermark_failed" } })}\n\n`));
          controller.close();
        }
      },
      async cancel(reason) {
        cancelled = true;
        await reader.cancel(reason).catch(() => undefined);
        reader.releaseLock();
        await finish("客户端关闭图片流");
      },
    });
    return {
      response: responseWithBody(source, stream, "streaming"),
      status: () => state,
    };
  }
  if (
    (type.includes("msgpack") || (options.octetStreamIsMsgpack && type.includes("octet-stream"))) &&
    source.body
  ) {
    const reader = source.body.getReader();
    const header = new Uint8Array(4);
    let headerBytes = 0,
      payload: Uint8Array | undefined,
      payloadBytes = 0,
      chunk = new Uint8Array(0),
      offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            if (offset === chunk.length) {
              const result = await reader.read();
              if (result.done) {
                if (headerBytes || payload)
                  throw new Error("Incomplete image stream frame");
                reader.releaseLock();
                controller.close();
                return;
              }
              chunk = result.value;
              offset = 0;
            }
            if (!payload) {
              const count = Math.min(4 - headerBytes, chunk.length - offset);
              header.set(chunk.subarray(offset, offset + count), headerBytes);
              headerBytes += count;
              offset += count;
              if (headerBytes < 4) continue;
              const length = new DataView(header.buffer).getUint32(0, false);
              if (!length || length > 64 * 1024 * 1024)
                throw new Error("Invalid image stream frame size");
              payload = new Uint8Array(length);
              payloadBytes = 0;
            }
            const count = Math.min(
              payload.length - payloadBytes,
              chunk.length - offset,
            );
            payload.set(chunk.subarray(offset, offset + count), payloadBytes);
            payloadBytes += count;
            offset += count;
            if (payloadBytes < payload.length) continue;
            const event = decode(payload) as Record<string, unknown>;
            let bytes: Uint8Array = payload;
            if (event && event.event_type === "final") {
              const field = event.image !== undefined ? "image" : "data",
                image = event[field];
              const index =
                Number.isSafeInteger(event.samp_ix) &&
                Number(event.samp_ix) >= 0
                  ? Number(event.samp_ix)
                  : 0;
              if (image instanceof Uint8Array || typeof image === "string") {
                const marked = await mark(
                  typeof image === "string"
                    ? Buffer.from(
                        image.replace(DATA_URL, ""),
                        "base64",
                      )
                    : image,
                  index,
                );
                const mime = detectWatermarkImageMime(marked);
                const prefix = typeof image === "string" && DATA_URL.test(image) && mime ? `data:${mime};base64,` : "";
                bytes = encode({
                  ...event,
                  [field]:
                    typeof image === "string"
                      ? prefix + Buffer.from(marked).toString("base64")
                      : marked,
                });
              } else if (options.required) throw new WatermarkSigningError("最终图像帧未包含图片");
            }
            const frame = new Uint8Array(4 + bytes.length);
            new DataView(frame.buffer).setUint32(0, bytes.length, false);
            frame.set(bytes, 4);
            payload = undefined;
            payloadBytes = 0;
            headerBytes = 0;
            controller.enqueue(frame);
            return;
          }
        } catch (error) {
          state = "failed";
          await reader.cancel().catch(() => undefined);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
    return {
      response: responseWithBody(source, stream, "streaming"),
      status: () => state,
    };
  }
  if (!/json|zip|image\/|octet-stream/.test(type) && !options.expectImage) return unchanged("skipped");
  const original = new Uint8Array(await source.arrayBuffer());
  try {
    let output: BodyInit;
    let outputType: string | undefined;
    if (type.includes("zip") || (original[0] === 0x50 && original[1] === 0x4b && original[2] === 0x03 && original[3] === 0x04)) {
      const zip = await JSZip.loadAsync(original);
      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && /\.(png|jpe?g|webp)$/i.test(entry.name),
      );
      // Work sequentially so a multi-image ZIP does not multiply peak image buffers.
      for (const [index, entry] of entries.entries()) {
        const originalName = entry.name;
        const marked = await mark(await entry.async("uint8array"), index);
        zip.file(originalName, marked);
      }
      output = entries.length
        ? new Uint8Array(
            await zip.generateAsync({
              type: "uint8array",
              compression: "STORE",
            }),
          )
        : original;
    } else if (type.includes("json")) {
      const payload = JSON.parse(Buffer.from(original).toString("utf8"));
      await markJson(payload);
      output = JSON.stringify(payload);
    } else {
      const signed = await mark(original, 0);
      output = signed;
      outputType = detectWatermarkImageMime(signed) || undefined;
    }
    if (options.expectImage && (state as ImageWatermarkStatus) !== "embedded") throw new WatermarkSigningError("图像响应未包含已签名图片");
    const response = responseWithBody(source, output, state, outputType);
    if (options.expectImage) response.headers.set("X-LFN-Generated-Samples", String(signedSamples.size));
    return { response, status: () => state };
  } catch (error) {
    state = "failed";
    if (options.required) throw error instanceof WatermarkSigningError ? error : new WatermarkSigningError("图像响应签名失败", { cause: error });
    return {
      response: responseWithBody(source, original, state),
      status: () => state,
    };
  }
}
