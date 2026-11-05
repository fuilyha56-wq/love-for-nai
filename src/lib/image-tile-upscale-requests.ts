import type { ImageUpscalePlan, ImageUpscaleTile } from "./image-tile-upscale";
import { retryAfterSeconds } from "./retry-after";

export const MAX_TILE_RETRIES = 5;
const TILE_REQUEST_TIMEOUT_MS = 180_000;
const MAX_RETRY_DELAY_STEP = 5;

export class TileStreamEndedWithoutImageError extends Error {
  constructor(message = "流式响应未返回最终图像") {
    super(message);
    this.name = "TileStreamEndedWithoutImageError";
  }
}

export type TiledUpscaleProgress = {
  completed: number;
  total: number;
  waiting: number;
  failed?: number;
  waitingForCapacity?: boolean;
};

type TileRequest = { tile: ImageUpscaleTile; retries: number; delayStep: number };
type TileRunOptions = {
  plan: ImageUpscalePlan;
  results: Map<number, Blob>;
  signal: AbortSignal;
  concurrency: number;
  refreshConcurrency?: (signal: AbortSignal) => Promise<number>;
  requestTile: (tile: ImageUpscaleTile, signal: AbortSignal) => Promise<Response>;
  readTile: (response: Response) => Promise<Blob>;
  onProgress: (progress: TiledUpscaleProgress) => void;
};

export async function decodeCachedUpscaleTile(results: Map<number, Blob>, index: number, total: number): Promise<ImageBitmap> {
  const blob = results.get(index);
  if (!blob) throw new Error(`分块 ${index + 1} 尚未生成`);
  if (typeof createImageBitmap !== "function") throw new Error("当前浏览器不支持解码分块图像");
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    results.delete(index);
    throw new Error(`第 ${index + 1}/${total} 块图像无法解码`, { cause: error });
  }
}

/** Retry individual failed requests through the same queue as the first attempts. */
export async function runImageUpscaleTiles({
  plan, results, signal, concurrency, refreshConcurrency, requestTile, readTile, onProgress,
}: TileRunOptions): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const pending = plan.tiles.filter((tile) => !results.has(tile.index)).map((tile) => ({ tile, retries: 0, delayStep: 0 }));
    const inFlight = new Map<number, AbortController>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const failedTiles = new Map<number, string>();
    const capacityController = new AbortController();
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let refreshing = false;
    let runFailure: Error | undefined;
    let stopped = false;

    const stopRun = (error: Error) => {
      runFailure = error;
      pending.length = 0;
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      clearInterval(refreshTimer);
      capacityController.abort();
    };

    const finishIfReady = () => {
      if (inFlight.size || pending.length || retryTimers.size) return;
      stopped = true;
      signal.removeEventListener("abort", abortRun);
      clearInterval(refreshTimer);
      capacityController.abort();
      if (runFailure) {
        reject(runFailure);
      } else if (failedTiles.size) {
        const indexes = [...failedTiles.keys()].sort((left, right) => left - right);
        const first = indexes[0];
        const detail = `第 ${first + 1}/${plan.tiles.length} 块失败：${failedTiles.get(first)}`;
        const summary = indexes.length === 1 ? detail : `${indexes.length} 块未完成（编号 ${indexes.map((index) => index + 1).join("、")}）。${detail}`;
        reject(new Error(summary));
      } else {
        resolve();
      }
    };

    const abortRun = () => {
      stopRun(new DOMException("已取消分块重绘", "AbortError"));
      for (const controller of inFlight.values()) controller.abort();
      pump();
    };

    const runTile = async ({ tile, retries, delayStep }: TileRequest, controller: AbortController) => {
      const timeoutError = new DOMException("单块请求超过 180 秒未返回", "TimeoutError");
      const timeout = setTimeout(() => controller.abort(timeoutError), TILE_REQUEST_TIMEOUT_MS);
      let response: Response | undefined;
      try {
        response = await requestTile(tile, controller.signal);
        const result = await readTile(response);
        controller.signal.throwIfAborted();
        results.set(tile.index, result);
      } catch (error) {
        if (runFailure) return;
        const timedOut = controller.signal.reason === timeoutError;
        const missingFinalImage = !timedOut && error instanceof TileStreamEndedWithoutImageError;
        if (missingFinalImage || retries < MAX_TILE_RETRIES) {
          const backoff = 1_000 * 2 ** delayStep;
          const retryAfter = retryAfterSeconds(response?.headers.get("Retry-After") ?? null, Date.now(), 0) * 1_000;
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            pending.push({
              tile,
              retries: missingFinalImage ? retries : retries + 1,
              delayStep: Math.min(delayStep + 1, MAX_RETRY_DELAY_STEP),
            });
            pump();
          }, Math.max(backoff, retryAfter));
          retryTimers.add(timer);
        } else {
          const detail = timedOut ? timeoutError.message : error instanceof Error ? error.message : "图像请求失败";
          failedTiles.set(tile.index, detail);
        }
      } finally {
        clearTimeout(timeout);
        inFlight.delete(tile.index);
        pump();
      }
    };

    const pump = () => {
      if (stopped) return;
      if (!runFailure && !refreshConcurrency && concurrency < 1 && (pending.length || retryTimers.size)) {
        stopRun(new Error("当前没有可用的重绘账号，恢复后可继续"));
      }
      while (!runFailure && inFlight.size < concurrency && pending.length) {
        const request = pending.shift()!;
        const controller = new AbortController();
        inFlight.set(request.tile.index, controller);
        void runTile(request, controller);
      }
      const waiting = pending.length + retryTimers.size;
      onProgress({
        completed: results.size, total: plan.tiles.length, waiting,
        ...(failedTiles.size ? { failed: failedTiles.size } : {}),
        ...(waiting && concurrency < 1 ? { waitingForCapacity: true } : {}),
      });
      finishIfReady();
    };

    if (refreshConcurrency) {
      refreshTimer = setInterval(async () => {
        if (refreshing || stopped || runFailure) return;
        refreshing = true;
        try {
          const next = await refreshConcurrency(capacityController.signal);
          if (!capacityController.signal.aborted) concurrency = next;
        } catch {
          // Keep the previous limit if a refresh fails.
        } finally {
          refreshing = false;
          pump();
        }
      }, 5_000);
    }
    signal.addEventListener("abort", abortRun, { once: true });
    pump();
  });
}
