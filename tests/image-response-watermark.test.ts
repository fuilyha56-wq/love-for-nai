import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { decode, encode } from "@msgpack/msgpack";
import JSZip from "jszip";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/provider/http", () => ({ downloadProviderImage: download }));
import { watermarkImageResponse } from "@/lib/image-response-watermark";
import { verifyWatermark } from "@/lib/image-watermark";
import {
  resetRuntimeConfigCache,
  updateRuntimeSettings,
} from "@/lib/runtime-config";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const options = {
  requestId: "api-request",
  requestFingerprint: "safe-fingerprint",
};
const original = process.env.LFN_DATA_DIR;
let directory = "";
beforeEach(async () => {
  download.mockReset();
  download.mockResolvedValue(`data:image/png;base64,${png.toString("base64")}`);
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-api-watermark-"));
  process.env.LFN_DATA_DIR = directory;
  resetRuntimeConfigCache();
  await updateRuntimeSettings({ watermarkEnabled: true });
});
afterEach(async () => {
  resetRuntimeConfigCache();
  if (original === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = original;
  await rm(directory, { recursive: true, force: true });
});
const verify = (bytes: Uint8Array) =>
  verifyWatermark(
    `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
  );
const frame = (event: unknown) => {
  const payload = encode(event),
    bytes = new Uint8Array(payload.length + 4);
  new DataView(bytes.buffer).setUint32(0, payload.length, false);
  bytes.set(payload, 4);
  return bytes;
};

describe("API image signatures across response protocols", () => {
  it("signs all JSON base64 images with distinct image IDs and removes obsolete entity headers", async () => {
    const result = await watermarkImageResponse(
      Response.json(
        {
          data: [
            { b64_json: png.toString("base64") },
            { b64_json: png.toString("base64") },
          ],
          usage: { total_tokens: 3 },
        },
        { headers: { etag: "old", "content-length": "1" } },
      ),
      71,
      "nai-v5-full",
      options,
    );
    const body = await result.response.json();
    const proofs = await Promise.all(
      body.data.map((i: { b64_json: string }) =>
        verify(Buffer.from(i.b64_json, "base64")),
      ),
    );
    expect(
      proofs.map((p) => [p.valid, p.shaMatch, p.payload?.imageId]),
    ).toEqual([
      [true, true, "api-request-1"],
      [true, true, "api-request-2"],
    ]);
    expect(body.usage.total_tokens).toBe(3);
    expect(result.response.headers.get("etag")).toBeNull();
    expect(result.response.headers.get("content-length")).toBeNull();
    expect(result.status()).toBe("embedded");
  });
  it("signs native ZIP images while preserving archive names, extra files and PNG pixels", async () => {
    const zip = new JSZip()
      .file("image_0.png", png)
      .file("nested/image_1.png", png)
      .file("info.txt", "keep");
    const result = await watermarkImageResponse(
      new Response(
        new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
        { headers: { "content-type": "application/zip" } },
      ),
      71,
      "nai-v5-full",
      options,
    );
    const marked = await JSZip.loadAsync(await result.response.arrayBuffer());
    for (const name of ["image_0.png", "nested/image_1.png"])
      expect(
        await verify(await marked.file(name)!.async("uint8array")),
      ).toMatchObject({
        valid: true,
        shaMatch: true,
        payload: { userId: 71, requestId: "api-request" },
      });
    expect(await marked.file("info.txt")!.async("string")).toBe("keep");
    expect(result.response.headers.get("x-lfn-watermark")).toBe("embedded");
  });
  it("forwards progress before completion and signs fragmented final MessagePack frames", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const progress = frame({
      event_type: "intermediate",
      samp_ix: 0,
      step_ix: 1,
      image: new Uint8Array([1, 2, 3]),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(progress);
      },
    });
    const result = await watermarkImageResponse(
      new Response(stream, {
        headers: {
          "content-type": "application/x-msgpack",
          "content-length": "1",
        },
      }),
      71,
      "nai-v5-full",
      options,
    );
    const reader = result.response.body!.getReader();
    expect((await reader.read()).value).toEqual(progress);
    const final = frame({
      event_type: "final",
      samp_ix: 0,
      image: new Uint8Array(png),
      other: "kept",
    });
    source.enqueue(final.slice(0, 3));
    source.enqueue(final.slice(3, 11));
    source.enqueue(final.slice(11));
    source.close();
    const output = (await reader.read()).value!;
    expect(new DataView(output.buffer).getUint32(0, false)).toBe(
      output.length - 4,
    );
    const event = decode(output.slice(4)) as {
      image: Uint8Array;
      other: string;
    };
    expect(event.other).toBe("kept");
    expect(await verify(event.image)).toMatchObject({
      valid: true,
      shaMatch: true,
    });
    expect((await reader.read()).done).toBe(true);
    expect(result.status()).toBe("embedded");
    expect(result.response.headers.get("content-length")).toBeNull();
  });
  it("reports a truncated stream as a failure instead of inventing a final image", async () => {
    const bytes = frame({
      event_type: "final",
      image: new Uint8Array(png),
    }).slice(0, 12);
    const result = await watermarkImageResponse(
      new Response(bytes, {
        headers: { "content-type": "application/x-msgpack" },
      }),
      71,
      "nai-v5-full",
      options,
    );
    await expect(result.response.arrayBuffer()).rejects.toThrow("Incomplete");
    expect(result.status()).toBe("failed");
  });
  it("signs URL-only results without credentials, and leaves disabled responses untouched", async () => {
    const json = JSON.stringify({
      data: [{ url: "https://images.invalid/example.png" }],
    });
    const skipped = await watermarkImageResponse(
      new Response(json, { headers: { "content-type": "application/json" } }),
      71,
      "nai-v5-full",
      options,
    );
    expect(skipped.status()).toBe("embedded");
    expect(download).toHaveBeenCalledExactlyOnceWith("https://images.invalid/example.png");
    const signed = await skipped.response.json();
    expect(await verifyWatermark(signed.data[0].url)).toMatchObject({ valid: true, shaMatch: true });
    await updateRuntimeSettings({ watermarkEnabled: false });
    const result = await watermarkImageResponse(
      new Response(png, { headers: { "content-type": "image/png" } }),
      71,
      "nai-v5-full",
      options,
    );
    expect(result.status()).toBe("disabled");
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(
      new Uint8Array(png),
    );
  });
  it("signs website images and image aliases even for partial results", async () => {
    const input = `data:image/png;base64,${png.toString("base64")}`;
    const marked = await watermarkImageResponse(Response.json({ images: [input], image: input, partial: true }, { status: 207 }), 71, "nai-v5-full", options);
    const body = await marked.response.json();
    expect(marked.response.status).toBe(207);
    expect(body.partial).toBe(true);
    expect(body.image).toBe(body.images[0]);
    expect(await verifyWatermark(body.image)).toMatchObject({ valid: true, shaMatch: true });
  });
  it("streams previews immediately, then signs final and done images across split SSE frames", async () => {
    const input = `data:image/png;base64,${png.toString("base64")}`;
    const encoder = new TextEncoder();
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({ start(controller) { push = controller; } });
    const result = await watermarkImageResponse(new Response(source, { headers: { "content-type": "text/event-stream" } }), 71, "nai-v5-full", options);
    const reader = result.response.body!.getReader();
    const preview = `event: preview\ndata: ${JSON.stringify({ image: input })}\n\n`;
    push.enqueue(encoder.encode(preview));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(preview);
    const final = `event: final\ndata: ${JSON.stringify({ image: input, sampleIndex: 0 })}\n\n`;
    const done = `event: done\ndata: ${JSON.stringify({ images: [input], image: input, historyIds: ["saved"] })}\n\n`;
    const reading = (async () => {
      let text = "";
      while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
      return text;
    })();
    push.enqueue(encoder.encode((final + done).slice(0, 45)));
    push.enqueue(encoder.encode((final + done).slice(45)));
    push.close();
    const frames = (await reading).trim().split("\n\n").map((text) => JSON.parse(text.split("\n").find((line) => line.startsWith("data:"))!.slice(5)));
    expect(frames[0].image).toBe(frames[1].image);
    expect(frames[1].historyIds).toEqual(["saved"]);
    expect(await verifyWatermark(frames[0].image)).toMatchObject({ valid: true, shaMatch: true });
    expect(result.status()).toBe("embedded");
  });
  it.each(["jpeg", "webp"] as const)("signs %s as PNG with unchanged decoded pixels and matching content type", async (format) => {
    const original = await sharp(png).toFormat(format).toBuffer();
    const marked = await watermarkImageResponse(new Response(new Uint8Array(original), { headers: { "content-type": `image/${format}` } }), 71, "image-model", options);
    const result = Buffer.from(await marked.response.arrayBuffer());
    expect(marked.response.headers.get("content-type")).toBe("image/png");
    expect(await sharp(result).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
    expect(await verify(result)).toMatchObject({ valid: true, shaMatch: true });
  });
  it("persists one signing key for concurrent first-use responses", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        watermarkImageResponse(
          new Response(png, { headers: { "content-type": "image/png" } }),
          71,
          "nai-v5-full",
          options,
        ),
      ),
    );
    const proofs = await Promise.all(
      results.map(async (r) =>
        verify(new Uint8Array(await r.response.arrayBuffer())),
      ),
    );
    expect(proofs.every((p) => p.valid && p.shaMatch)).toBe(true);
    expect(new Set(proofs.map((p) => p.payload?.keyId)).size).toBe(1);
    const stored = JSON.parse(
      await readFile(path.join(directory, "watermark-keys.json"), "utf8"),
    );
    expect(stored.keyId).toBe(proofs[0].payload?.keyId);
  });
});
