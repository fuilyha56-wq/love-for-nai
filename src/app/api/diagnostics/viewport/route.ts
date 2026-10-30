import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import {
  VIEWPORT_DIAGNOSTIC_COLUMNS,
  VIEWPORT_DIAGNOSTIC_BOUNDS,
  VIEWPORT_DIAGNOSTIC_VERSION,
  VIEWPORT_DIAGNOSTIC_MAX_BYTES,
  VIEWPORT_DIAGNOSTIC_MAX_ROWS,
} from "@/lib/viewport-diagnostic-schema";

export const runtime = "nodejs";
const capturePattern = /^[a-f0-9]{32}$/;
const directory = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "viewport-diagnostics");
const reply = (status: number, message: string, receipt?: string) =>
  Response.json({ message, ...(receipt ? { receipt } : {}) }, { status, headers: { "Cache-Control": "no-store" } });

// Inactive unless an operator installs a short-lived, write-only capture ticket.
// This endpoint cannot read traces, input text, account data, or arbitrary files.
export async function POST(request: Request) {
  let session: { capture: string; expiresAt: number };
  try {
    session = JSON.parse(await readFile(path.join(directory(), "session.json"), "utf8"));
    if (!capturePattern.test(session.capture) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      return reply(404, "诊断入口已关闭");
    }
  } catch { return reply(404, "诊断入口未开启"); }
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/json")) return reply(400, "无效的诊断记录");
  if (Number(request.headers.get("content-length")) > VIEWPORT_DIAGNOSTIC_MAX_BYTES) return reply(413, "记录超过大小限制");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > VIEWPORT_DIAGNOSTIC_MAX_BYTES) { await reader.cancel(); return reply(413, "记录超过大小限制"); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body.capture !== "string" || !capturePattern.test(body.capture) ||
      !timingSafeEqual(Buffer.from(body.capture), Buffer.from(session.capture))) return reply(404, "诊断入口无效");
    if (body.version !== VIEWPORT_DIAGNOSTIC_VERSION || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > VIEWPORT_DIAGNOSTIC_MAX_ROWS ||
      body.rows.some((row: unknown) => !Array.isArray(row) || row.length !== VIEWPORT_DIAGNOSTIC_COLUMNS.length ||
        row.some((value, index) => typeof value !== "number" || !Number.isFinite(value) ||
          value < VIEWPORT_DIAGNOSTIC_BOUNDS[index][0] || value > VIEWPORT_DIAGNOSTIC_BOUNDS[index][1]))) {
      return reply(400, "记录格式无效");
    }
    // Reconstruct only the allowlisted numeric matrix. Never persist extra keys
    // supplied by a client, cookies, headers, a URL, or the capture ticket.
    const payload = JSON.stringify({ version: VIEWPORT_DIAGNOSTIC_VERSION, recordedAt: Date.now(), columns: VIEWPORT_DIAGNOSTIC_COLUMNS, rows: body.rows });
    const folder = path.join(directory(), session.capture);
    await mkdir(folder, { recursive: true });
    for (let slot = 1; slot <= 10; slot++) {
      let file;
      try { file = await open(path.join(folder, `${slot}.json`), "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
      try { await file.writeFile(payload); } finally { await file.close(); }
      return reply(200, "诊断记录已上传", `${session.capture.slice(0, 8)}-${slot}`);
    }
    return reply(429, "本次诊断记录已满");
  } catch { return reply(400, "无法保存诊断记录"); }
}
