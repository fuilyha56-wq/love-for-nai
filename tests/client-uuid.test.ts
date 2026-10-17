import { afterEach, describe, expect, it, vi } from "vitest";
import { clientUuid } from "@/lib/client-uuid";

afterEach(() => vi.unstubAllGlobals());
describe("client UUIDs for activity drafts", () => {
  it("uses the secure-context API when available", () => {
    const randomUUID = vi.fn(() => "3ee129a6-c723-4e5d-a182-bd725db109ab");
    vi.stubGlobal("crypto", { randomUUID });
    expect(clientUuid()).toBe("3ee129a6-c723-4e5d-a182-bd725db109ab");
    expect(randomUUID).toHaveBeenCalledOnce();
  });
  it("works on HTTP origins where randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => crypto.getRandomValues(bytes));
    const realCrypto = globalThis.crypto;
    getRandomValues.mockImplementation((bytes) => realCrypto.getRandomValues(bytes));
    vi.stubGlobal("crypto", { getRandomValues });
    const ids = Array.from({ length: 20 }, clientUuid);
    expect(new Set(ids).size).toBe(20);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(getRandomValues).toHaveBeenCalledTimes(20);
  });
  it("can still create a draft when Web Crypto is entirely unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(clientUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
