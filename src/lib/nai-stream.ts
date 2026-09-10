import { decode } from "@msgpack/msgpack";

export type NaiStreamEvent = {
  eventType: "intermediate" | "final" | "error";
  sampleIndex: number;
  stepIndex?: number;
  image?: Uint8Array;
  message?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string | number, unknown>))
    record[String(key)] = item;
  return record;
}

function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "number"))
    return Uint8Array.from(value);
  if (typeof value === "string" && value) {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return bytes;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function parseNaiStreamMessage(bytes: Uint8Array): NaiStreamEvent | null {
  const decoded = decode(bytes);
  const record = asRecord(decoded);
  if (!record) return null;
  const eventTypeRaw = String(record.event_type || "");
  const eventType =
    eventTypeRaw === "final" || eventTypeRaw === "error"
      ? eventTypeRaw
      : "intermediate";
  const image = asBytes(record.image ?? record.data);
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : undefined;
  if (eventType === "error" || record.error)
    return {
      eventType: "error",
      sampleIndex: asInt(record.samp_ix) ?? 0,
      message: message || "Stream generation failed",
    };
  return {
    eventType,
    sampleIndex: asInt(record.samp_ix) ?? 0,
    stepIndex: asInt(record.step_ix),
    image,
    message,
  };
}

export async function* readNaiMsgpackStream(
  stream: ReadableStream<Uint8Array> | null,
): AsyncGenerator<NaiStreamEvent> {
  if (!stream) return;
  const reader = stream.getReader();
  let leftover = new Uint8Array(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const merged = new Uint8Array(leftover.length + value.length);
      merged.set(leftover);
      merged.set(value, leftover.length);
      leftover = merged;
      while (leftover.length >= 4) {
        const length =
          (leftover[0] << 24) | (leftover[1] << 16) | (leftover[2] << 8) | leftover[3];
        if (length <= 0 || leftover.length < 4 + length) break;
        const payload = leftover.subarray(4, 4 + length);
        leftover = leftover.subarray(4 + length);
        const event = parseNaiStreamMessage(payload);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function pngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
