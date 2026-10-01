import { describe, expect, it } from "vitest";
import { mergeTaggerPrompt, parseTaggerLabels, selectTaggerPredictions, taggerBgrTensor, taggerInputSpec } from "@/lib/tagger-core";

describe("WD 标签模型的真实输入与输出契约", () => {
  it("按 CSV 行顺序而非 id 排序，保留引号内的逗号、换行及转义", () => {
    expect(parseTaggerLabels('\uFEFFtag_id,name,category\r\n9,general,9\r\n2,"blue, sky",0\r\n1,"character_""a""",4\r\n3,"line\nbreak",0')).toEqual([{ name: "general", category: 9 }, { name: "blue, sky", category: 0 }, { name: 'character_"a"', category: 4 }, { name: "line\nbreak", category: 0 }]);
  });
  it.each(["name\nfoo", "name,category\nfoo,", 'name,category\n"foo,0', "name,category\nfoo,rating", "name,category\n,0"])("拒绝缺失列或损坏 CSV：%s", csv => { expect(() => parseTaggerLabels(csv)).toThrow(); });
  it("识别 NHWC / NCHW，拒绝动态尺寸、多 batch 或非 float32", () => {
    expect(taggerInputSpec([1, 448, 448, 3])).toEqual({ layout: "nhwc", size: 448, dimensions: [1, 448, 448, 3] });
    expect(taggerInputSpec(["batch", 3, 384, 384]).layout).toBe("nchw");
    for (const dimensions of [[2, 448, 448, 3], [1, "height", "width", 3], [1, 256, 512, 3], [1, 3, 3], [1, 4096, 4096, 3]]) expect(() => taggerInputSpec(dimensions)).toThrow();
    expect(() => taggerInputSpec([1, 448, 448, 3], "uint8")).toThrow();
  });
  it("使用未归一化 BGR，透明像素先合成到白色，通道布局准确", () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
    expect([...taggerBgrTensor(rgba, taggerInputSpec([1, 2, 2, 3]))]).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]);
    expect([...taggerBgrTensor(rgba, taggerInputSpec([1, 3, 2, 2]))]).toEqual([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  });
  it("分离通用/角色阈值，跳过评级，按置信度降序，保留颜文字", () => {
    const labels = parseTaggerLabels("name,category\nsafe,9\nblue_hair,0\nsome_character,4\nlow_score,0\n^_^,0");
    expect(selectTaggerPredictions(labels, [0.99, 0.7, 0.8, 0.1, 0.6], 0.35, 0.85).map(item => item.name)).toEqual(["blue hair", "^_^"]);
    expect(selectTaggerPredictions(labels, [0.99, 0.7, 0.8, 0.1, 0.6], 0.65, 0.75).map(item => item.name)).toEqual(["some character", "blue hair"]);
    expect(() => selectTaggerPredictions(labels, [0.1], 0.35, 0.85)).toThrow("CSV");
    expect(() => selectTaggerPredictions(labels, [1, 2, 0.5, 0.5, 0.5], 0.35, 0.85)).toThrow("概率");
  });
  it("合并标签去重且保留原有提示词权重与换行", () => {
    expect(mergeTaggerPrompt("blue_hair, {red eyes}\nscenery", ["blue hair", "red dress", "red dress"])).toBe("blue_hair, {red eyes}\nscenery, red dress");
    expect(mergeTaggerPrompt("", ["blue hair"])).toBe("blue hair");
  });
});
