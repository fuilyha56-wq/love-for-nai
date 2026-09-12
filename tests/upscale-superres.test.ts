import { describe, expect, it } from "vitest";
import { pngDimensions, stripDataUrl } from "@/lib/png-dims";
import {
  UPSCALE_MAX_PIXELS,
  upscaleAnlasCost,
} from "@/lib/image-pricing";
import { affCost } from "@/lib/aff";

// 最小合法 PNG：1x1 红色像素（IHDR 宽高位于第 16-24 字节）。
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngWithDimensions(width: number, height: number): string {
  // 构造仅含签名+IHDR 头部的 PNG 前置片段（pngDimensions 只读前 24 字节）。
  const header = Buffer.alloc(24);
  header.write("\x89PNG\r\n\x1a\n", 0, "binary");
  header.writeUInt32BE(13, 8); // IHDR 数据长度
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header.toString("base64");
}

describe("pngDimensions", () => {
  it("解析真实 PNG 的 IHDR 尺寸", () => {
    expect(pngDimensions(PNG_1X1_BASE64)).toEqual({ width: 1, height: 1 });
  });

  it("兼容 data URL 前缀", () => {
    expect(pngDimensions(`data:image/png;base64,${PNG_1X1_BASE64}`)).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("解析任意声明的宽高（超分计费依据）", () => {
    expect(pngDimensions(pngWithDimensions(1536, 2048))).toEqual({
      width: 1536,
      height: 2048,
    });
  });

  it("拒绝非 PNG 与损坏输入", () => {
    expect(pngDimensions(Buffer.from("hello world").toString("base64"))).toBeNull();
    expect(pngDimensions("")).toBeNull();
    expect(pngDimensions("????")).toBeNull();
  });
});

describe("stripDataUrl", () => {
  it("剥离 data URL 前缀，裸 base64 原样返回", () => {
    expect(stripDataUrl(`data:image/png;base64,${PNG_1X1_BASE64}`)).toBe(PNG_1X1_BASE64);
    expect(stripDataUrl(PNG_1X1_BASE64)).toBe(PNG_1X1_BASE64);
  });
});

describe("upscaleAnlasCost", () => {
  it("按 NAI 官网价格表输出 1-4 档", () => {
    expect(upscaleAnlasCost(832, 1216)).toBe(1); // 1,011,712 px
    expect(upscaleAnlasCost(1024, 1024)).toBe(1); // 边界 1,048,576 px
    expect(upscaleAnlasCost(1024, 1536)).toBe(2); // 1,572,864 px
    expect(upscaleAnlasCost(1472, 1472)).toBe(3); // 2,166,784 px
    expect(upscaleAnlasCost(1536, 2048)).toBe(4); // 上限 3,145,728 px
  });

  it("超过 3145728 像素与非法尺寸抛错", () => {
    expect(() => upscaleAnlasCost(1664, 2432)).toThrow(/3145728/);
    expect(() => upscaleAnlasCost(0, 100)).toThrow();
    expect(UPSCALE_MAX_PIXELS).toBe(3_145_728);
  });
});

describe("affCost 的 upscale 分支", () => {
  it("超分费用跟随输入面积档位，而非旧的固定 4 AFF", () => {
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 832,
        height: 1216,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(1);
    expect(
      affCost({
        model: "nai-diffusion-5-full",
        width: 1024,
        height: 1536,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(2);
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 1536,
        height: 2048,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(4);
  });

  it("超分尺寸超限时抛错", () => {
    expect(() =>
      affCost({
        model: "nai-diffusion-5-curated",
        width: 2048,
        height: 2048,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toThrow();
  });
});
