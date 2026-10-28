import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adjustAff, affStatus, getUserAvatar } from "@/lib/aff";
import { readAvatar, saveAvatar } from "@/lib/avatars";

const original = process.env.LFN_DATA_DIR;
beforeEach(async () => { process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-avatar-")); });
afterEach(() => { if (original == null) delete process.env.LFN_DATA_DIR; else process.env.LFN_DATA_DIR = original; });
const image = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#a83a4c" } }).png().toBuffer();

describe("paid compressed avatars", () => {
  it("compresses and crops a static avatar, debits exactly 5 personal AFF and replays safely", async () => {
    await adjustAff(7, 20, "test credit");
    const input = await image(), requestId = randomUUID();
    const saved = await saveAvatar(7, input, requestId, { x: .5, y: -.2, zoom: 1.5 });
    expect(saved).toMatchObject({ charged: 5, balance: 15 });
    const avatar = (await readAvatar(7))!;
    expect(await sharp(avatar.data).metadata()).toMatchObject({ width: 256, height: 256, format: "webp" });
    expect(avatar.data.length).toBeLessThan(100_000);
    expect(await saveAvatar(7, input, requestId, { x: .5, y: -.2, zoom: 1.5 })).toMatchObject({ charged: 0, balance: 15 });
    expect((await affStatus(7)).balance).toBe(15);
  });
  it("rejects insufficient funds and invalid image data without changing the avatar or balance", async () => {
    await adjustAff(7, 4, "test credit");
    await expect(saveAvatar(7, await image(), randomUUID())).rejects.toThrow("余额不足");
    expect(await getUserAvatar(7)).toBeNull();
    expect((await affStatus(7)).balance).toBe(4);
    await expect(saveAvatar(7, Buffer.from("not an image"), randomUUID())).rejects.toThrow();
    expect((await affStatus(7)).balance).toBe(4);
  });
  it("serializes concurrent purchases and never allows the personal balance to become negative", async () => {
    await adjustAff(7, 5, "test credit");
    const input = await image();
    const results = await Promise.allSettled([saveAvatar(7, input, randomUUID()), saveAvatar(7, input, randomUUID())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await affStatus(7)).balance).toBe(0);
    expect(await getUserAvatar(7)).not.toBeNull();
  });
});
