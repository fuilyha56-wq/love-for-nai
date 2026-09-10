import { describe, expect, it } from "vitest";
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
});
