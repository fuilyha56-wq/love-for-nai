import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { POST } from "@/app/api/diagnostics/viewport/route";
import { VIEWPORT_DIAGNOSTIC_COLUMNS, VIEWPORT_DIAGNOSTIC_MAX_BYTES } from "@/lib/viewport-diagnostic-schema";

const capture = "1234567890abcdef1234567890abcdef";
let folder: string;
const root = () => path.join(folder, "viewport-diagnostics");
const row = () => VIEWPORT_DIAGNOSTIC_COLUMNS.map(() => 0);
const request = (data: unknown) => new Request("http://localhost/api/diagnostics/viewport", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});
async function enable(expiresAt = Date.now() + 60_000) {
  await mkdir(root(), { recursive: true });
  await writeFile(path.join(root(), "session.json"), JSON.stringify({ capture, expiresAt }));
}

describe("temporary viewport diagnostic collection", () => {
  beforeEach(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), "lfn-viewport-"));
    vi.stubEnv("LFN_DATA_DIR", folder);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (!path.resolve(folder).startsWith(path.join(path.resolve(os.tmpdir()), "lfn-viewport-"))) throw new Error("Unsafe test cleanup");
    await rm(folder, { recursive: true, force: true });
  });
  it("is unavailable without an active ticket and rejects expired or incorrect tickets", async () => {
    const data = { capture, version: 1, rows: [row()] };
    expect((await POST(request(data))).status).toBe(404);
    await enable(Date.now() - 1);
    expect((await POST(request(data))).status).toBe(404);
    await enable();
    expect((await POST(request({ ...data, capture: "f".repeat(32) }))).status).toBe(404);
  });
  it("stores only the numeric allowlist and bounds each ticket to ten records", async () => {
    await enable();
    const data = { capture, version: 1, rows: [row()], text: "never persist", url: "never persist" };
    for (let i = 0; i < 10; i++) expect((await POST(request(data))).status).toBe(200);
    expect((await POST(request(data))).status).toBe(429);
    const files = await readdir(path.join(root(), capture));
    expect(files).toHaveLength(10);
    const stored = await readFile(path.join(root(), capture, "1.json"), "utf8");
    expect(stored).not.toContain("never persist");
    expect(stored).not.toContain(capture);
    expect(JSON.parse(stored).rows).toEqual([row()]);
  });
  it("rejects text, extra columns, and oversized bodies even without content-length", async () => {
    await enable();
    const values = row();
    const bad = [...values];
    (bad as unknown[])[0] = "input text";
    expect((await POST(request({ capture, version: 1, rows: [bad] }))).status).toBe(400);
    expect((await POST(request({ capture, version: 1, rows: [[...values, 0]] }))).status).toBe(400);
    expect((await POST(request({ capture, version: 1, rows: [values], extra: "x".repeat(VIEWPORT_DIAGNOSTIC_MAX_BYTES) }))).status).toBe(413);
  });
});
