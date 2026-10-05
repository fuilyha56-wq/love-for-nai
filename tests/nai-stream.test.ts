import { describe, expect, it, vi } from "vitest";
import { encode } from "@msgpack/msgpack";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import { parseNaiStreamMessage, readNaiMsgpackStream } from "@/lib/nai-stream";

function framed(message: Record<string, unknown>): Uint8Array {
  const payload = encode(message);
  const frame = new Uint8Array(4 + payload.length);
  frame[0] = (payload.length >>> 24) & 0xff;
  frame[1] = (payload.length >>> 16) & 0xff;
  frame[2] = (payload.length >>> 8) & 0xff;
  frame[3] = payload.length & 0xff;
  frame.set(payload, 4);
  return frame;
}

describe("NAI native stream protocol", () => {
  it.each([0, 1, 2, 3])("preserves explicit quality disabling and valid UC preset %i", (ucPreset) => {
    const body = naiNativeGenerationBody({
      model: "nai-v5-full", prompt: "1girl, custom quality", negative_prompt: "custom uc",
      qualityToggle: false, ucPreset,
    });
    expect(body.input).toBe("1girl, custom quality");
    expect(body.parameters).toMatchObject({ qualityToggle: false, ucPreset, negative_prompt: "custom uc" });
  });

  it("keeps legacy quality and UC defaults when flags are omitted", () => {
    const body = naiNativeGenerationBody({ model: "nai-v4.5-full", prompt: "1girl" });
    expect(body.parameters).toMatchObject({ qualityToggle: true, ucPreset: 0 });
  });

  it("generates a random seed when omitted and preserves negative seeds", () => {
    const random = naiNativeGenerationBody({ model: "nai-v4.5-full", prompt: "1girl" });
    expect(random.parameters).toEqual(expect.objectContaining({ seed: expect.any(Number) }));
    const randomSeed = (random.parameters as { seed: number }).seed;
    expect(randomSeed).toBeGreaterThan(0);
    expect(randomSeed).toBeLessThanOrEqual(0xffffffff);

    const negative = naiNativeGenerationBody({ model: "nai-v4.5-full", prompt: "1girl", seed: -42 });
    expect(negative.parameters).toMatchObject({ seed: -42 });
  });

  it.each([
    { qualityToggle: "false", ucPreset: "3" },
    { qualityToggle: 0, ucPreset: -1 },
    { qualityToggle: null, ucPreset: 4 },
    { qualityToggle: {}, ucPreset: 1.5 },
    { qualityToggle: [], ucPreset: Number.NaN },
    { qualityToggle: undefined, ucPreset: Number.POSITIVE_INFINITY },
    { qualityToggle: "true", ucPreset: null },
    { qualityToggle: 1, ucPreset: false },
  ])("rejects invalid preset flags without coercing them (%j)", (flags) => {
    const body = naiNativeGenerationBody({ model: "nai-v5-full", prompt: "1girl", ...flags });
    expect(body.parameters).toMatchObject({ qualityToggle: true, ucPreset: 0 });
  });

  it("builds a msgpack stream payload with official fields", () => {
    const body = naiNativeGenerationBody(
      {
        operation: "generate",
        model: "nai-v4.5-full",
        prompt: "1girl",
        negative_prompt: "lowres",
        width: 832,
        height: 1216,
        steps: 28,
        n: 1,
        characterPrompts: [{ prompt: "cat ears", center: { x: 0.3, y: 0.4 } }],
      },
      { stream: true, samples: 1 },
    );
    expect(body.model).toBe("nai-diffusion-4-5-full");
    expect(body.action).toBe("generate");
    expect(body.input).toBe("1girl");
    const parameters = body.parameters as Record<string, unknown>;
    expect(parameters.stream).toBe("msgpack");
    expect(parameters.n_samples).toBe(1);
    expect(parameters.v4_prompt).toMatchObject({
      caption: { base_caption: "1girl" },
    });
  });

  it("maps infinite-canvas outpainting to NAI infill", () => {
    const body = naiNativeGenerationBody({
      operation: "outpainting",
      model: "nai-v5-inpaint",
      prompt: "extend the scene",
      width: 1024,
      height: 1024,
      image: "data:image/png;base64,aW1hZ2U=",
      mask: "data:image/png;base64,bWFzaw==",
    });
    expect(body.action).toBe("infill");
    expect(body.model).toBe("nai-diffusion-5-full-inpainting");
    expect(body.parameters).toMatchObject({
      image: "aW1hZ2U=",
      mask: "bWFzaw==",
      params_version: 4,
    });
  });

  it("maps each character's positive and negative prompts independently with identical coordinates", () => {
    const characters = [
      { prompt: "cat ears", negativePrompt: "dog ears", negative: "ignored fallback", center: { x: 0.3, y: 0.4 } },
      { prompt: "blue eyes", negative: "red eyes", center: { x: 0.7, y: 0.6 } },
      { prompt: "red hair", center: { x: 0.5, y: 0.2 } },
    ];
    const body = naiNativeGenerationBody({
      model: "nai-v5-full", prompt: "two characters", negative_prompt: "lowres", characterPrompts: characters,
    });
    const parameters = body.parameters as Record<string, unknown>;
    expect(parameters.characterPrompts).toEqual(characters);
    expect(parameters.v4_prompt).toEqual({
      caption: {
        base_caption: "two characters",
        char_captions: [
          { char_caption: "cat ears", centers: [{ x: 0.3, y: 0.4 }] },
          { char_caption: "blue eyes", centers: [{ x: 0.7, y: 0.6 }] },
          { char_caption: "red hair", centers: [{ x: 0.5, y: 0.2 }] },
        ],
      }, use_coords: true, use_order: true,
    });
    expect(parameters.v4_negative_prompt).toEqual({
      caption: {
        base_caption: "lowres",
        char_captions: [
          { char_caption: "dog ears", centers: [{ x: 0.3, y: 0.4 }] },
          { char_caption: "red eyes", centers: [{ x: 0.7, y: 0.6 }] },
          { char_caption: "", centers: [{ x: 0.5, y: 0.2 }] },
        ],
      }, legacy_uc: false,
    });
  });

  it("keeps empty native character negatives explicit and defaults missing coordinates", () => {
    const body = naiNativeGenerationBody({
      model: "nai-v4.5-full", prompt: "scene",
      characterPrompts: [null, { prompt: "1girl", negativePrompt: "", negative: "ignored" }, { prompt: "1boy", negativePrompt: 123, negative: "hat" }],
    });
    const parameters = body.parameters as Record<string, unknown>;
    expect(parameters.v4_negative_prompt).toMatchObject({
      caption: { char_captions: [
        { char_caption: "", centers: [{ x: 0.5, y: 0.5 }] },
        { char_caption: "hat", centers: [{ x: 0.5, y: 0.5 }] },
      ] },
    });
  });

  it.each([
    ["nai-v4.5-full", "nai-diffusion-4-5-full-inpainting", 3],
    ["nai-v4.5-curated", "nai-diffusion-4-5-full-inpainting", 3],
    ["nai-v5-full", "nai-diffusion-5-full-inpainting", 4],
    ["nai-v5-curated", "nai-diffusion-5-full-inpainting", 4],
  ])("maps %s edits to %s", (model, expected, paramsVersion) => {
    const body = naiNativeGenerationBody({
      operation: "edits",
      model,
      prompt: "redraw",
      width: 832,
      height: 1216,
      image: "data:image/png;base64,aW1hZ2U=",
      mask: "data:image/png;base64,bWFzaw==",
    });
    expect(body.action).toBe("infill");
    expect(body.model).toBe(expected);
    expect(body.parameters).toMatchObject({ params_version: paramsVersion });
  });

  it("parses intermediate and final msgpack events", () => {
    const preview = parseNaiStreamMessage(
      encode({
        event_type: "intermediate",
        samp_ix: 0,
        step_ix: 3,
        image: Uint8Array.from([1, 2, 3]),
      }),
    );
    const finalEvent = parseNaiStreamMessage(
      encode({
        event_type: "final",
        samp_ix: 0,
        image: Uint8Array.from([9, 8, 7]),
      }),
    );
    expect(preview).toMatchObject({
      eventType: "intermediate",
      sampleIndex: 0,
      stepIndex: 3,
    });
    expect(Array.from(preview?.image || [])).toEqual([1, 2, 3]);
    expect(finalEvent).toMatchObject({ eventType: "final", sampleIndex: 0 });
    expect(Array.from(finalEvent?.image || [])).toEqual([9, 8, 7]);
  });

  it("reads length-prefixed msgpack frames from a stream", async () => {
    const first = framed({
      event_type: "intermediate",
      samp_ix: 0,
      step_ix: 0,
      image: Uint8Array.from([1]),
    });
    const second = framed({
      event_type: "final",
      samp_ix: 0,
      image: Uint8Array.from([2]),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first.subarray(0, 6));
        controller.enqueue(first.subarray(6));
        controller.enqueue(second);
        controller.close();
      },
    });
    const events = [];
    for await (const event of readNaiMsgpackStream(stream)) events.push(event);
    expect(events.map((item) => item.eventType)).toEqual(["intermediate", "final"]);
    expect(Array.from(events[1].image || [])).toEqual([2]);
  });

  it("cancels the source after an error event ends parsing early", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(framed({ event_type: "error", message: "upstream failed" }));
      },
      cancel,
    });
    const events = [];
    for await (const event of readNaiMsgpackStream(stream)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "error", message: "upstream failed" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
