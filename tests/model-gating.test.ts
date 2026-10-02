import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLIENT_MODEL_POLICY,
  filterNaiModelIds,
  filterNaiModelOptions,
  isNaiModelEnabledForPolicy,
  naiModelFamily,
} from "@/lib/model-policy";
import {
  getRuntimeModelPolicy,
  isNaiModelEnabled,
  resetRuntimeConfigCache,
  updateRuntimeSettings,
} from "@/lib/runtime-config";

const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
  vi.restoreAllMocks();
});

describe("NAI model policy", () => {
  it("recognizes canonical and upstream diffusion family names without false positives", () => {
    expect(naiModelFamily("nai-v5-full")).toBe("v5");
    expect(naiModelFamily("nai-v4.5-inpaint-limit")).toBe("v4.5");
    expect(naiModelFamily("nai-diffusion-5-curated")).toBe("v5");
    expect(naiModelFamily("nai-diffusion-4-5-full")).toBe("v4.5");
    expect(naiModelFamily("nai-v4-full")).toBeNull();
    expect(naiModelFamily("artist-v5-style")).toBeNull();
  });

  it("filters model ids and options by both family gates while preserving other providers", () => {
    const policy = { enableV5Models: false, enableV45Models: true };
    expect(filterNaiModelIds(["nai-v5-full", "nai-v4.5-full", "nai-v3", "gpt-image-1"], policy))
      .toEqual(["nai-v4.5-full", "nai-v3", "gpt-image-1"]);
    expect(filterNaiModelOptions([
      { value: "nai-v5-full", label: "V5" },
      { value: "gemini-3-pro-image-preview", label: "Gemini" },
    ], policy)).toEqual([{ value: "gemini-3-pro-image-preview", label: "Gemini" }]);
    expect(isNaiModelEnabledForPolicy("gpt-image-1", DEFAULT_CLIENT_MODEL_POLICY)).toBe(true);
  });

  it("reads runtime policy and applies it to generation model checks", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-model-policy-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ enableV5Models: false, enableV45Models: true });
    expect(await getRuntimeModelPolicy()).toEqual({ enableV5Models: false, enableV45Models: true });
    expect(await isNaiModelEnabled("nai-v5-full")).toBe(false);
    expect(await isNaiModelEnabled("nai-v4.5-full")).toBe(true);
    expect(await isNaiModelEnabled("nai-v3")).toBe(true);
    expect(await isNaiModelEnabled("custom-image-model")).toBe(true);
  });
});
