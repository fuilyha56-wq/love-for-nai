export const MAX_IMAGE_REQUEST_SAMPLES = 8;
export const STUDIO_BATCH_SAMPLES = 4;

export function studioBatchSize(mode: "once" | "sequential"): number {
  return mode === "sequential" ? STUDIO_BATCH_SAMPLES : MAX_IMAGE_REQUEST_SAMPLES;
}

export function splitImageBatches(total: number, size: number): number[] {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(size) || size < 1)
    throw new RangeError("图像批次参数无效");
  const batches: number[] = [];
  for (let remaining = total; remaining > 0; remaining -= size)
    batches.push(Math.min(size, remaining));
  return batches;
}
