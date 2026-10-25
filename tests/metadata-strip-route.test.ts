import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/session";
import { POST } from "@/app/api/images/metadata-strip/route";
import { saveHistory } from "@/lib/history";
import { verifyWatermark } from "@/lib/image-watermark";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

const originalDataDir = process.env.LFN_DATA_DIR;
const imageUrl = (data: Buffer) => `data:image/png;base64,${data.toString("base64")}`;
const request = (data: Buffer, type = "image/png") => new Request("http://localhost/api/images/metadata-strip", {
  method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(data),
});

beforeEach(async () => {
  process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-strip-route-"));
  resetRuntimeConfigCache();
  await updateRuntimeSettings({ watermarkEnabled: true });
  vi.mocked(getSession).mockResolvedValue({ userId: 7 } as NonNullable<Awaited<ReturnType<typeof getSession>>>);
});
afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

async function sourceImage() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#369" } }).png().toBuffer();
}
const parameters = { operation: "generate", model: "nai-v5-full", prompt: "private prompt", seed: 2345 };

describe("metadata removal downloads", () => {
  it("retains the current user's server watermark for unsigned streamed result bytes", async () => {
    const source = await sourceImage();
    const [history] = await saveHistory(7, parameters, [imageUrl(source)], null, { requestId: "own-stream" });
    const response = await POST(request(source));
    expect(response.status).toBe(200);
    const proof = await verifyWatermark(imageUrl(Buffer.from(await response.arrayBuffer())));
    expect(proof).toMatchObject({ valid: true, shaMatch: true, payload: {
      imageId: history.id, requestId: "own-stream", userId: 7, metadataStripped: true,
    } });
    expect(proof.payload).not.toHaveProperty("parameters");
  });

  it("never uses another account's provenance even for identical response bytes", async () => {
    const source = await sourceImage();
    await saveHistory(8, parameters, [imageUrl(source)], null, { requestId: "other-account" });
    const response = await POST(request(source));
    expect(response.status).toBe(200);
    expect(await verifyWatermark(imageUrl(Buffer.from(await response.arrayBuffer())))).toMatchObject({ valid: false });
  });

  it("uses the actual file format for the response MIME type", async () => {
    const response = await POST(request(await sourceImage(), "image/jpeg"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("requires a signed-in user", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request(await sourceImage()))).status).toBe(401);
  });
});
