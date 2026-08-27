import { describe, expect, it } from "vitest";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造带 tEXt chunk 的最小 PNG。 */
function pngWithText(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes);
  chunkData[keywordBytes.length] = 0;
  chunkData.set(textBytes, keywordBytes.length + 1);

  const type = encoder.encode("tEXt");
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, chunkData.length);
  const crcInput = new Uint8Array(type.length + chunkData.length);
  crcInput.set(type);
  crcInput.set(chunkData, type.length);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc32(crcInput));

  const iend = Uint8Array.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  const total = PNG_SIGNATURE.length + lengthBytes.length + crcInput.length + crcBytes.length + iend.length;
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of [PNG_SIGNATURE, lengthBytes, crcInput, crcBytes, iend]) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

const V4_COMMENT = JSON.stringify({
  prompt: "1girl, {{curly}} braces",
  steps: 28,
  height: 1216,
  scale: 5,
  uc: "lowres",
  v4_prompt: {
    caption: { base_caption: "1girl, {{curly}} braces", char_captions: [] },
    use_coords: false,
    use_order: true,
  },
  parameters: { width: 832, sampler: "k_euler" },
});

describe("parseNaiImageMetadata", () => {
  it("parses NAI v4 nested comment from PNG tEXt", () => {
    const metadata = parseNaiImageMetadata(pngWithText("Comment", V4_COMMENT));
    expect(metadata).not.toBeNull();
    expect(metadata?.isNai).toBe(true);
    expect(metadata?.parameters.prompt).toBe("1girl, {{curly}} braces");
    expect(metadata?.parameters.width).toBe(832);
    expect(metadata?.parameters.sampler).toBe("k_euler");
    expect(metadata?.parameters.negative_prompt).toBe("lowres");
  });

  it("returns null for non-image bytes", () => {
    expect(parseNaiImageMetadata(new TextEncoder().encode("hello"))).toBeNull();
  });

  it("returns null for PNG without NAI metadata", () => {
    expect(parseNaiImageMetadata(pngWithText("Title", "plain"))).toBeNull();
  });

  it("normalizes input/uc aliases", () => {
    const comment = JSON.stringify({ input: "cat", uc: "dog", width: 512 });
    const metadata = parseNaiImageMetadata(pngWithText("Comment", comment));
    expect(metadata?.parameters.prompt).toBe("cat");
    expect(metadata?.parameters.negative_prompt).toBe("dog");
  });
});
