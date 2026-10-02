import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { embedWatermark, verifyWatermark } from "@/lib/image-watermark";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("LFN image watermark", () => {
  it("embeds a valid signature without changing decoded image pixels", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: true, publicUrl: "https://love-for-nai.test" });
    const marked = await embedWatermark(PNG, "image-1", 7, "nai-v5-full", {
      requestId: "request-1",
      requestFingerprint: "fingerprint-1",
      parameters: { prompt: "hello", steps: 28, width: 64, height: 64, seed: 123 },
    });
    expect(marked).not.toBe(PNG);
    const result = await verifyWatermark(marked);
    expect(result.valid).toBe(true);
    expect(result.shaMatch).toBe(true);
    expect(result.payload).toMatchObject({ requestId: "request-1", imageId: "image-1", userId: 7, model: "nai-v5-full" });
    expect(result.payload?.parameters).toMatchObject({ steps: 28, seed: 123 });
  });

  it("does not embed when disabled", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-disabled-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: false });
    expect(await embedWatermark(PNG, "image-1", 7, "nai-v5-full")).toBe(PNG);
  });
});
