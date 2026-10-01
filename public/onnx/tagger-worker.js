// The runtime and WASM are copied from the same installed onnxruntime-web build.
import * as ort from "./ort.wasm.min.mjs";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("./", import.meta.url).href;
let session;
function metadata() {
  const input = session.inputMetadata[0];
  if (!input?.isTensor) throw new Error("标签模型首个输入不是图片张量。");
  return { dimensions: input.shape, type: input.type };
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      if (session) await session.release();
      session = await ort.InferenceSession.create(new Uint8Array(data.model), {
        executionProviders: ["wasm"],
        externalData: data.externalData.map(file => ({ path: file.path, data: new Uint8Array(file.data) })),
      });
      if (session.inputNames.length !== 1 || session.outputNames.length !== 1) throw new Error("请导入单输入、单输出的 WD tagger 模型。");
      self.postMessage({ id: data.id, ...metadata() });
    } else if (data.type === "metadata") {
      if (!session) throw new Error("本地标签模型尚未加载。");
      self.postMessage({ id: data.id, ...metadata() });
    } else if (data.type === "infer") {
      if (!session) throw new Error("本地标签模型尚未加载。");
      const result = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", data.tensor, data.dimensions) });
      const output = result[session.outputNames[0]];
      if (output.type !== "float32") throw new Error("标签模型必须返回 float32 概率。");
      const scores = new Float32Array(output.data);
      self.postMessage({ id: data.id, scores }, [scores.buffer]);
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: `本地标签模型运行失败：${error instanceof Error ? error.message : String(error)}` });
  }
};
