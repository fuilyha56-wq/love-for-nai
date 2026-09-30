import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setNovelaiKey } from "@/lib/provider/store";

vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId: 73001 }) }));

const { GET } = await import("@/app/api/providers/novelai/route");
let directory: string;
const oldDataDir = process.env.LFN_DATA_DIR;
const oldSecret = process.env.LFN_PROVIDER_ENCRYPTION_KEY;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lfn-provider-account-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_PROVIDER_ENCRYPTION_KEY = "test-provider-key-longer-than-thirty-two-bytes";
  await setNovelaiKey(73001, "pst-test-token");
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  if (oldDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = oldDataDir;
  if (oldSecret === undefined) delete process.env.LFN_PROVIDER_ENCRYPTION_KEY;
  else process.env.LFN_PROVIDER_ENCRYPTION_KEY = oldSecret;
  await rm(directory, { recursive: true, force: true });
});

describe("NovelAI Key 账号状态", () => {
  it("401 或 403 时不把失效 Key 报为已连接，但保留保存状态供用户更换", async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
      const response = await GET();
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.account).toBeNull();
      expect(result.keySaved).toBe(true);
      expect(result.error).toContain("无效");
    }
  });

  it("上游临时故障时仍可保留已导入来源", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const result = await (await GET()).json();
    expect(result.account.connected).toBe(true);
    expect(result.error).toContain("503");
  });
});
