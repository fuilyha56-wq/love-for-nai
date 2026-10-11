import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameGatewayUpstream, requestGatewayImageQuote, sameGatewayQuote } from "@/lib/gateway-billing";

afterEach(() => vi.unstubAllGlobals());

describe("Gateway authoritative AFF quotes", () => {
  it("uses the quote endpoint and keeps AFF, Anlas and usage markers distinct", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://gateway.test/v1/images/price-quote");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer gateway-key");
      return Response.json(
        { anlas_cost: 3, usage: { prompt_tokens: 25, completion_tokens: 0, total_tokens: 25 } },
        { headers: { "X-Anlas-Cost": "3", "X-Prompt-Tokens": "25" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const quote = await requestGatewayImageQuote("http://gateway.test/v1/", "gateway-key", {
      model: "nai-v5-full",
      width: 512,
      height: 512,
      steps: 28,
      samples: 1,
    });
    expect(quote).toEqual({ anlasCost: 3, promptTokens: 25, affCost: 3 });
    expect(sameGatewayQuote(quote, 3)).toBe(true);
    expect(sameGatewayQuote(quote, 4)).toBe(false);
  });

  it("does not equate NewAPI usage tokens with Gateway Anlas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { anlas_cost: 0, usage: { prompt_tokens: 25, completion_tokens: 0, total_tokens: 25 } },
      { headers: { "X-Anlas-Cost": "0", "X-Prompt-Tokens": "25" } },
    )));
    const quote = await requestGatewayImageQuote("http://gateway.test", "token", {
      model: "nai-v5-full",
      width: 512,
      height: 512,
      steps: 28,
      samples: 1,
    });
    expect(quote).toMatchObject({ anlasCost: 0, promptTokens: 25, affCost: 0 });
  });

  it("identifies only matching Gateway endpoints regardless of /v1 suffix", () => {
    expect(isSameGatewayUpstream({ baseUrl: "https://gw.test/v1/" }, { baseUrl: "https://gw.test" })).toBe(true);
    expect(isSameGatewayUpstream({ baseUrl: "https://provider.test" }, { baseUrl: "https://gw.test" })).toBe(false);
  });
});
