import { describe, expect, it } from "vitest";
import {
  InvalidJsonError,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

describe("parseJsonBody", () => {
  it("parses JSON objects", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "nai" }),
    });
    await expect(parseJsonBody(request)).resolves.toEqual({ name: "nai" });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "{",
    });
    await expect(parseJsonBody(request)).rejects.toThrow(InvalidJsonError);
  });

  it.each(["null", "[]", "1", '"text"'])(
    "rejects non-object JSON: %s",
    async (body) => {
      const request = new Request("http://localhost", { method: "POST", body });
      await expect(parseJsonBody(request)).rejects.toThrow(
        "请求体必须是 JSON 对象",
      );
    },
  );
});

it("narrows optional primitive values", () => {
  expect(optionalString("value")).toBe("value");
  expect(optionalString(1)).toBeUndefined();
  expect(optionalNumber(1.5)).toBe(1.5);
  expect(optionalNumber(Number.NaN)).toBeUndefined();
});
