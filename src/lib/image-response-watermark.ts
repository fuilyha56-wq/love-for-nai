import { decode, encode } from "@msgpack/msgpack";
import JSZip from "jszip";
import { watermarkImages, type WatermarkOptions } from "./image-watermark";
import { getRuntimeSettings } from "./runtime-config";

export type ImageWatermarkStatus =
  "embedded" | "disabled" | "skipped" | "failed";
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

/** Keep image bytes intact except PNG metadata; stream progress remains streamed. */
export async function watermarkImageResponse(
  source: Response,
  userId: number,
  model: string,
  options: WatermarkOptions = {},
): Promise<{ response: Response; status: () => ImageWatermarkStatus }> {
  let state: ImageWatermarkStatus = "skipped";
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
  if (!(await getRuntimeSettings()).watermarkEnabled)
    return unchanged("disabled");
  const mark = async (bytes: Uint8Array, index: number) => {
    const result = await watermarkImages(
      [`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`],
      userId,
      model,
      { ...options, imageId: `${options.requestId || "lfn"}-${index + 1}` },
    );
    merge(result.status);
    return new Uint8Array(
      Buffer.from(
        result.images[0].replace(/^data:image\/[^;]+;base64,/, ""),
        "base64",
      ),
    );
  };
  const type = (source.headers.get("content-type") || "").toLowerCase();
  if (
    (type.includes("msgpack") || type.includes("octet-stream")) &&
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
                        image.replace(/^data:image\/[^;]+;base64,/, ""),
                        "base64",
                      )
                    : image,
                  index,
                );
                const prefix =
                  typeof image === "string"
                    ? image.match(/^data:image\/[^;]+;base64,/)?.[0] || ""
                    : "";
                bytes = encode({
                  ...event,
                  [field]:
                    typeof image === "string"
                      ? prefix + Buffer.from(marked).toString("base64")
                      : marked,
                });
              }
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
  if (!/json|zip|image\//.test(type)) return unchanged("skipped");
  const original = new Uint8Array(await source.arrayBuffer());
  try {
    let output: BodyInit;
    if (type.includes("zip")) {
      const zip = await JSZip.loadAsync(original);
      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && /\.png$/i.test(entry.name),
      );
      // Work sequentially so a multi-image ZIP does not multiply peak image buffers.
      for (const [index, entry] of entries.entries())
        zip.file(
          entry.name,
          await mark(await entry.async("uint8array"), index),
        );
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
      if (Array.isArray(payload.data))
        for (const [index, item] of payload.data.entries()) {
          if (item && typeof item.b64_json === "string") {
            const raw = Buffer.from(
              item.b64_json.replace(/^data:image\/[^;]+;base64,/, ""),
              "base64",
            );
            item.b64_json = Buffer.from(await mark(raw, index)).toString(
              "base64",
            );
          }
        }
      output = JSON.stringify(payload);
    } else output = await mark(original, 0);
    return {
      response: responseWithBody(source, output, state),
      status: () => state,
    };
  } catch {
    state = "failed";
    return {
      response: responseWithBody(source, original, state),
      status: () => state,
    };
  }
}
