/** WaifuDiffusion tagger contract: CSV row order matches output, raw BGR float input. */
export type TaggerLabel = { name: string; category: number };
export type TaggerInputSpec = { layout: "nhwc" | "nchw"; size: number; dimensions: number[] };
export type TaggerPrediction = { name: string; score: number; category: number };
const KAOMOJIS = new Set(["0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>", "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u", "x_x", "|_|", "||_||"]);

export function parseTaggerLabels(csv: string): TaggerLabel[] {
  if (csv.length > 16_000_000) throw new Error("标签 CSV 超过 16 MB，请选择模型对应的 selected_tags.csv。");
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  const source = csv.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (quoted || !value) quoted = !quoted;
      else throw new Error("标签 CSV 引号格式错误。");
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(value); value = "";
      if (char !== ",") {
        if (row.some(cell => cell.trim())) rows.push(row);
        row = [];
        if (char === "\r" && source[index + 1] === "\n") index += 1;
      }
    } else value += char;
  }
  if (quoted) throw new Error("标签 CSV 含有未闭合的引号。");
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  const header = rows.shift()?.map(cell => cell.trim().toLowerCase()) || [];
  const nameIndex = header.indexOf("name"), categoryIndex = header.indexOf("category");
  if (nameIndex < 0 || categoryIndex < 0) throw new Error("标签 CSV 必须包含 name 和 category 列。");
  if (!rows.length || rows.length > 100_000) throw new Error("标签 CSV 必须包含 1 至 100000 个标签。");
  return rows.map((cells, index) => {
    const name = cells[nameIndex]?.trim(), category = Number(cells[categoryIndex]);
    if (!name || cells[categoryIndex]?.trim() === "" || !Number.isInteger(category)) throw new Error(`标签 CSV 第 ${index + 2} 行缺少有效的名称或分类。`);
    return { name, category };
  });
}

export function taggerInputSpec(dimensions: readonly (number | string)[], type = "float32"): TaggerInputSpec {
  if (type !== "float32") throw new Error("此 tagger 需要 float32 输入的 WD 模型。");
  if (dimensions.length !== 4 || (typeof dimensions[0] === "number" && dimensions[0] !== 1)) throw new Error("此 tagger 需要单张图片的四维输入。");
  const layout = dimensions[3] === 3 ? "nhwc" : dimensions[1] === 3 ? "nchw" : null;
  if (!layout) throw new Error("模型输入需要 NHWC 或 NCHW 三通道布局。");
  const height = dimensions[layout === "nhwc" ? 1 : 2], width = dimensions[layout === "nhwc" ? 2 : 3];
  if (typeof height !== "number" || typeof width !== "number" || height !== width || !Number.isInteger(height) || height < 1 || height > 2048) throw new Error("请选择具有固定正方形输入尺寸的 WD tagger 模型（最大 2048）。");
  return { layout, size: height, dimensions: layout === "nhwc" ? [1, height, height, 3] : [1, 3, height, height] };
}

export function taggerBgrTensor(rgba: Uint8ClampedArray | Uint8Array, spec: TaggerInputSpec): Float32Array {
  const pixels = spec.size * spec.size;
  if (rgba.length !== pixels * 4) throw new Error("标签模型图片尺寸与输入不一致。");
  const data = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const alpha = rgba[index * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const offset = spec.layout === "nhwc" ? index * 3 + channel : channel * pixels + index;
      data[offset] = rgba[index * 4 + 2 - channel] * alpha + 255 * (1 - alpha);
    }
  }
  return data;
}

export function selectTaggerPredictions(labels: readonly TaggerLabel[], scores: ArrayLike<number>, generalThreshold: number, characterThreshold: number): TaggerPrediction[] {
  if (scores.length !== labels.length) throw new Error(`模型输出 ${scores.length} 个标签，但 CSV 有 ${labels.length} 行；请导入配套的标签文件。`);
  if (![generalThreshold, characterThreshold].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("标签阈值必须在 0 至 1 之间。");
  return labels.flatMap((label, index) => {
    const score = Number(scores[index]);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("模型输出需要 0 至 1 的标签概率；此模型不符合 WD tagger 格式。");
    if (label.category !== 0 && label.category !== 4) return [];
    if (score <= (label.category === 4 ? characterThreshold : generalThreshold)) return [];
    return [{ ...label, name: KAOMOJIS.has(label.name) ? label.name : label.name.replaceAll("_", " "), score }];
  }).sort((left, right) => right.score - left.score);
}

export function mergeTaggerPrompt(prompt: string, tags: readonly string[]): string {
  const existing = new Set(prompt.split(/[,\n]/).map(value => value.trim().toLowerCase().replaceAll("_", " ")));
  const added = tags.filter(tag => { const key = tag.trim().toLowerCase().replaceAll("_", " "); if (!key || existing.has(key)) return false; existing.add(key); return true; });
  return added.length ? `${prompt.trim()}${prompt.trim() ? ", " : ""}${added.join(", ")}` : prompt;
}
