import { decode, encode } from "@msgpack/msgpack";
import { safeUpstreamMessage, type UpstreamErrorPrivacy } from "./upstream-error";

/** Observe frames once, copying each payload once rather than concatenating on every network chunk. */
export class NaiStreamCompletion {
  private header = new Uint8Array(4);
  private headerBytes = 0;
  private payload: Uint8Array | null = null;
  private payloadBytes = 0;
  readonly samples = new Set<number>();
  error?: string;
  constructor(private expected: number, private privacy: UpstreamErrorPrivacy = {}) {}
  feed(chunk: Uint8Array, emit?: (frame: Uint8Array) => void) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.payload) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        this.header.set(
          chunk.subarray(offset, offset + count),
          this.headerBytes,
        );
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < 4) continue;
        const length = new DataView(this.header.buffer).getUint32(0, false);
        if (!length || length > 64 * 1024 * 1024)
          throw new Error("上游流帧长度无效");
        this.payload = new Uint8Array(length);
        this.payloadBytes = 0;
      }
      const count = Math.min(
        this.payload.length - this.payloadBytes,
        chunk.length - offset,
      );
      this.payload.set(
        chunk.subarray(offset, offset + count),
        this.payloadBytes,
      );
      this.payloadBytes += count;
      offset += count;
      if (this.payloadBytes === this.payload.length) {
        const value = decode(this.payload) as Record<string, unknown>;
        let publicPayload = this.payload;
        if (value && typeof value === "object") {
          if (value.event_type === "error" || value.error) {
            this.error = safeUpstreamMessage(value, { ...this.privacy, fallback: "上游生成失败" });
            // Error frames may carry arbitrary nested headers/configuration.
            // Return only the protocol error envelope, never that diagnostic object.
            publicPayload = encode({ event_type: "error", message: this.error });
          }
          const index = Number(value.samp_ix ?? 0);
          const image = value.image ?? value.data;
          if (
            value.event_type === "final" &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < this.expected &&
            ((image instanceof Uint8Array && image.length > 0) ||
              (typeof image === "string" && image.length > 0))
          )
            this.samples.add(index);
        }
        if (emit) {
          const frame = new Uint8Array(4 + publicPayload.length);
          new DataView(frame.buffer).setUint32(0, publicPayload.length, false);
          frame.set(publicPayload, 4);
          emit(frame);
        }
        this.headerBytes = 0;
        this.payload = null;
        this.payloadBytes = 0;
      }
    }
  }
  result() {
    const incomplete = this.payload !== null || this.headerBytes > 0;
    return {
      samples: this.samples.size,
      error:
        this.error ||
        (incomplete
          ? "上游流在完整帧返回前中断"
          : this.samples.size < this.expected
            ? "上游流未返回全部最终图片"
            : undefined),
    };
  }
}

export function observeNativeImageCompletion(
  response: Response,
  expected: number,
  onComplete: (result: { samples: number; error?: string }) => Promise<void>,
  privacy: UpstreamErrorPrivacy = {},
): Response {
  if (!response.body) throw new Error("上游响应没有图片流");
  const reader = response.body.getReader(),
    observer = new NaiStreamCompletion(expected, privacy);
  let cancelled = false,
    completion: Promise<void> | undefined;
  const finish = (error?: string) => {
    if (error) observer.error = safeUpstreamMessage(error, privacy);
    return (completion ??= onComplete(observer.result()));
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A network chunk can contain only part of a frame. Keep reading until
        // there is a complete public frame instead of leaving the consumer waiting.
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const result = observer.result();
            await finish();
            if (!cancelled) {
              if (result.error && !observer.error) {
                const message = encode({
                  event_type: "error",
                  message: result.error,
                });
                const frame = new Uint8Array(4 + message.length);
                new DataView(frame.buffer).setUint32(0, message.length, false);
                frame.set(message, 4);
                controller.enqueue(frame);
              }
              controller.close();
            }
            reader.releaseLock();
            return;
          }
          let emitted = false;
          observer.feed(value, (frame) => { if (!cancelled) { emitted = true; controller.enqueue(frame); } });
          if (emitted || cancelled) return;
        }
      } catch (error) {
        const message =
          safeUpstreamMessage(error, { ...privacy, fallback: "上游图片流读取失败" });
        await reader.cancel().catch(() => undefined);
        await finish(message).catch((failure) =>
          console.error("[lfn] 原生流结算失败", failure),
        );
        if (!cancelled) controller.error(new Error(message));
      }
    },
    async cancel() {
      // Continue observing production on disconnect, so cancelling an already
      // produced image cannot turn a completed upstream request into a refund.
      cancelled = true;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          observer.feed(value);
        }
        await finish();
      } catch (error) {
        await finish(safeUpstreamMessage(error, { ...privacy, fallback: "上游流中断" }));
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* An outstanding pull releases the same reader. */
        }
      }
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The transparent fallback has no local charge to settle, but shares frame privacy. */
export function sanitizeNativeImageStream(response: Response, privacy: UpstreamErrorPrivacy): Response {
  return observeNativeImageCompletion(response, 0, async () => {}, privacy);
}
