import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addProvider } from "@/lib/provider/store";

const auth = vi.hoisted(() => ({ userId: 74101 }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId: auth.userId }) }));

const { GET } = await import("@/app/api/providers/route");
let directory: string;
const previousDataDir = process.env.LFN_DATA_DIR;
const previousKey = process.env.LFN_PROVIDER_ENCRYPTION_KEY;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lfn-provider-api-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_PROVIDER_ENCRYPTION_KEY = "test-provider-key-longer-than-thirty-two-bytes";
  await addProvider(auth.userId, {
    name: "Mixed models", baseUrl: "https://models.example.com", apiKey: "must-not-leak", models: [],
    modelEntries: [
      { id: "vision", capabilities: "image" },
      { id: "writer", capabilities: "text" },
      { id: "multimodal", capabilities: "both" },
    ],
  });
});

afterAll(async () => {
  if (previousDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = previousDataDir;
  if (previousKey === undefined) delete process.env.LFN_PROVIDER_ENCRYPTION_KEY;
  else process.env.LFN_PROVIDER_ENCRYPTION_KEY = previousKey;
  await rm(directory, { recursive: true, force: true });
});

describe("provider registry API adapter", () => {
  it("returns legacy image shape by default without exposing credentials", async () => {
    const response = await GET(new Request("https://local.test/api/providers"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.items[0]).toMatchObject({ models: ["vision", "multimodal"], hasKey: true });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("filters registry entries by requested modality and leaves both-capability models eligible", async () => {
    const image = await (await GET(new Request("https://local.test/api/providers?modality=image"))).json();
    const text = await (await GET(new Request("https://local.test/api/providers?modality=text"))).json();
    expect(image.items[0].modelEntries.map((model: { id: string }) => model.id)).toEqual(["vision", "multimodal"]);
    expect(text.items[0].modelEntries.map((model: { id: string }) => model.id)).toEqual(["writer", "multimodal"]);
  });

  it("rejects unknown modality values", async () => {
    const response = await GET(new Request("https://local.test/api/providers?modality=audio"));
    expect(response.status).toBe(400);
  });
});
