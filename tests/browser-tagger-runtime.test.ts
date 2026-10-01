import { expect, it } from "vitest";
import * as ort from "onnxruntime-web/wasm";
import { parseTaggerLabels, selectTaggerPredictions, taggerBgrTensor, taggerInputSpec } from "@/lib/tagger-core";

// A 220-byte ONNX graph: channel ReduceMean across H/W followed by division by 255.
// Output depends on the image pixels, so RGB/BGR and threshold mistakes are observable.
const MODEL = "CAgSEExGTiB0ZXN0IGZpeHR1cmU6wQEKOgoFaW1hZ2USBW1lYW5zIgpSZWR1Y2VNZWFuKg0KBGF4ZXNAAUACoAEHKg8KCGtlZXBkaW1zGACgAQIKGwoFbWVhbnMKBXNjYWxlEgZzY29yZXMiA011bBIYbGZuLWJyb3dzZXItdGFnZ2VyLXNtb2tlKhEIARABQgVzY2FsZUoEgYCAO1ofCgVpbWFnZRIWChQIARIQCgIIAQoCCAIKAggCCgIIA2IYCgZzY29yZXMSDgoMCAESCAoCCAEKAggDQgIQCw==";

it("在实际 ONNX Runtime Web WASM 中运行图片输入，正确识别 BGR 通道并过滤标签", async () => {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(new Uint8Array(Buffer.from(MODEL, "base64")), { executionProviders: ["wasm"] });
  try {
    const metadata = session.inputMetadata[0];
    expect(metadata.isTensor).toBe(true);
    if (!metadata.isTensor) throw new Error("Expected image tensor");
    const spec = taggerInputSpec(metadata.shape, metadata.type);
    const pixels = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const input = new ort.Tensor("float32", taggerBgrTensor(pixels, spec), spec.dimensions);
    const outputs = await session.run({ [session.inputNames[0]]: input });
    const scores = outputs[session.outputNames[0]].data as Float32Array;
    expect([...scores]).toEqual([0, 0, 1]);
    const labels = parseTaggerLabels("name,category\nblue_color,0\ngreen_character,4\nred_color,0");
    expect(selectTaggerPredictions(labels, scores, 0.35, 0.85)).toEqual([{ name: "red color", category: 0, score: 1 }]);
  } finally { await session.release(); }
}, 15_000);
