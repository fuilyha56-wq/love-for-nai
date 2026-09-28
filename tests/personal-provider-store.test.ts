import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addProvider, deleteProvider, getNovelaiKey, getProvider, listProviders, setNovelaiKey } from "@/lib/provider/store";
import { isPublicIp, validateApiKey, validateProviderBaseUrl } from "@/lib/provider/validation";
import { parseNovelaiSubscription } from "@/lib/provider/novelai";

let directory: string;
const oldDataDir = process.env.LFN_DATA_DIR;
const oldSecret = process.env.LFN_PROVIDER_ENCRYPTION_KEY;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lfn-provider-test-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_PROVIDER_ENCRYPTION_KEY = "test-provider-key-longer-than-thirty-two-bytes";
});

afterAll(async () => {
  if (oldDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = oldDataDir;
  if (oldSecret === undefined) delete process.env.LFN_PROVIDER_ENCRYPTION_KEY;
  else process.env.LFN_PROVIDER_ENCRYPTION_KEY = oldSecret;
  await rm(directory, { recursive: true, force: true });
});

describe("个人提供商密钥", () => {
  it("按用户隔离并加密保存，不在列表中返回 Key", async () => {
    const item = await addProvider(71001, {
      name: "Image API", baseUrl: "https://example.com", apiKey: "secret-provider-key",
      models: ["flux-dev"],
    });
    await setNovelaiKey(71001, "pst-secret-novelai-key");
    const disk = await readFile(path.join(directory, "providers", "71001.enc"), "utf8");
    expect(disk).not.toContain("secret-provider-key");
    expect(disk).not.toContain("pst-secret-novelai-key");
    expect(JSON.stringify(await listProviders(71001))).not.toContain("secret-provider-key");
    expect((await getProvider(71001, item.id))?.apiKey).toBe("secret-provider-key");
    expect(await getProvider(71002, item.id)).toBeNull();
    expect(await getNovelaiKey(71002)).toBeNull();
    expect(await deleteProvider(71001, item.id)).toBe(true);
    expect(await listProviders(71001)).toEqual([]);
  });

  it("拒绝本机、内网、非 HTTPS 和可注入请求头的 Key", () => {
    expect(() => validateProviderBaseUrl("http://example.com")).toThrow();
    expect(() => validateProviderBaseUrl("https://127.0.0.1")).toThrow();
    expect(() => validateProviderBaseUrl("https://user:pass@example.com")).toThrow();
    expect(() => validateProviderBaseUrl("https://service.internal")).toThrow();
    expect(validateProviderBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com");
    expect(() => validateApiKey("good\r\nX-Evil: yes")).toThrow();
    for (const ip of ["127.0.0.1", "10.4.5.6", "172.16.2.1", "192.168.0.1", "169.254.169.254", "::1", "fc00::1", "fe80::1"])
      expect(isPublicIp(ip)).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
  });

  it("只从官方订阅数据提取卡片字段并归一时间", () => {
    const account = parseNovelaiSubscription({
      tier: 3, active: true, expiresAt: 1_800_000_000,
      trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 23 },
      usage: { percent: 97, isNegative: false, timeUntilNextPercent: 7888 },
      keystore: "must-not-leak",
    });
    expect(account).toEqual({ connected: true, tier: 3, active: true, expiresAt: 1_800_000_000_000,
      anlas: { fixed: 100, purchased: 23, total: 123 },
      usage: { percent: 97, isNegative: false, timeUntilNextPercent: 7888 },
    });
    expect(JSON.stringify(account)).not.toContain("keystore");
  });
});
