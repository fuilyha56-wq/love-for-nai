import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addProvider, deleteProvider, getNovelaiKey, getProvider, listProviders, listRegistryEntries, listTextProviders, resolveTextProviderModel, setNovelaiKey } from "@/lib/provider/store";
import { isPublicIp, validateApiKey, validateImageProviderProtocol, validateProviderBaseUrl, validateProviderCapability } from "@/lib/provider/validation";
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
      models: ["flux-dev"], protocol: "openai-images",
    });
    await setNovelaiKey(71001, "pst-secret-novelai-key");
    const disk = await readFile(path.join(directory, "providers", "71001.enc"), "utf8");
    expect(disk).not.toContain("secret-provider-key");
    expect(disk).not.toContain("pst-secret-novelai-key");
    expect(JSON.stringify(await listProviders(71001))).not.toContain("secret-provider-key");
    expect((await getProvider(71001, item.id))?.apiKey).toBe("secret-provider-key");
    expect((await listProviders(71001))[0].protocol).toBe("openai-images");
    expect(await getProvider(71002, item.id)).toBeNull();
    expect(await getNovelaiKey(71002)).toBeNull();
    expect(await deleteProvider(71001, item.id)).toBe(true);
    expect(await listProviders(71001)).toEqual([]);
  });

  it("按模型能力提供故事模型并解析三段式引用", async () => {
    const item = await addProvider(71003, {
      name: "Unified Text", baseUrl: "https://text.example.com", apiKey: "text-provider-key",
      models: [], modelEntries: [
        { id: "vision-only", capabilities: "image" },
        { id: "writer-a", capabilities: "text" },
        { id: "writer-b", capabilities: "both" },
      ], capability: "both",
    });
    expect((await listTextProviders(71003))[0].modelEntries).toEqual([
      { id: "vision-only", capabilities: "image" },
      { id: "writer-a", capabilities: "text" },
      { id: "writer-b", capabilities: "both" },
    ]);
    expect(await resolveTextProviderModel(71003, item.id, "writer-b")).toMatchObject({ model: "writer-b" });
    expect(await resolveTextProviderModel(71003, item.id, "vision-only")).toBeNull();
    expect(validateProviderCapability("both")).toBe("both");
  });

  it("迁移旧图像 providers 文件和旧 story-providers 文件到同一加密 registry", async () => {
    const userId = 71004;
    const providerKey = createHash("sha256").update("lfn-personal-providers-v1\0").update(process.env.LFN_PROVIDER_ENCRYPTION_KEY!).digest();
    const imageIv = randomBytes(12);
    const imageCipher = createCipheriv("aes-256-gcm", providerKey, imageIv);
    const imagePayload = { version: 1, items: [{ id: "legacy-image", name: "旧图像", baseUrl: "https://legacy.example.com", apiKey: "legacy-image-secret", models: ["flux-old"], createdAt: "2025-01-01T00:00:00.000Z" }], novelaiKey: null };
    const imageBytes = Buffer.concat([imageCipher.update(JSON.stringify(imagePayload), "utf8"), imageCipher.final()]);
    await mkdir(path.join(directory, "providers"), { recursive: true });
    await writeFile(path.join(directory, "providers", `${userId}.enc`), ["v1", imageIv.toString("base64url"), imageCipher.getAuthTag().toString("base64url"), imageBytes.toString("base64url")].join("."));

    const storyKey = createHash("sha256").update("lfn-development-secret-change-me").update("story-provider-secrets-v1").digest();
    const storyIv = randomBytes(12);
    const storyCipher = createCipheriv("aes-256-gcm", storyKey, storyIv);
    const storyBytes = Buffer.concat([storyCipher.update("legacy-story-secret", "utf8"), storyCipher.final()]);
    await mkdir(path.join(directory, "story-providers"), { recursive: true });
    await writeFile(path.join(directory, "story-providers", `${userId}.json`), JSON.stringify([{ id: "legacy-story", kind: "openai", name: "旧故事", model: "writer-old", baseUrl: "https://story.example.com", encryptedKey: [storyIv.toString("base64url"), storyCipher.getAuthTag().toString("base64url"), storyBytes.toString("base64url")].join(".") }]));

    const entries = await listRegistryEntries(userId);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "legacy-image", secret: "legacy-image-secret", modelEntries: [{ id: "flux-old", capabilities: "image" }] }),
      expect.objectContaining({ id: "legacy-story", secret: "legacy-story-secret", modelEntries: [{ id: "writer-old", capabilities: "text" }] }),
    ]));
    expect((await listRegistryEntries(userId, "image")).map((entry) => entry.id)).toContain("legacy-image");
    expect((await listRegistryEntries(userId, "text")).map((entry) => entry.id)).toContain("legacy-story");
    expect((await readFile(path.join(directory, "providers", `${userId}.enc`), "utf8"))).toMatch(/^v2\./);
  });

  it("拒绝本机、内网、非 HTTPS 和可注入请求头的 Key", () => {
    expect(() => validateProviderBaseUrl("http://example.com")).toThrow();
    expect(() => validateProviderBaseUrl("https://127.0.0.1")).toThrow();
    expect(() => validateProviderBaseUrl("https://user:pass@example.com")).toThrow();
    expect(() => validateProviderBaseUrl("https://service.internal")).toThrow();
    expect(validateProviderBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com");
    expect(validateProviderBaseUrl("https://generativelanguage.googleapis.com/v1beta/")).toBe("https://generativelanguage.googleapis.com");
    expect(validateImageProviderProtocol(undefined)).toBe("auto");
    expect(validateImageProviderProtocol("gemini")).toBe("gemini");
    expect(() => validateImageProviderProtocol("custom-http")).toThrow("协议无效");
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
