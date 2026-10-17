import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { getRiskSettings } from "./risk-settings";

let lastRoot = "", lastRun = 0, running: Promise<void> | undefined;
/** Only generated diagnostics/grants expire here; financial ledgers are never touched. */
export function maintainRiskStorage(now = Date.now()): Promise<void> {
  const root = path.resolve(/* turbopackIgnore: true */ process.env.LFN_DATA_DIR || "data");
  if (running) return running;
  if (lastRoot === root && now - lastRun < 3600000) return Promise.resolve();
  lastRoot = root; lastRun = now;
  running = (async () => {
    const settings = await getRiskSettings();
    const targets = [
      { directory: path.join(root, "request-audit", "journal"), pattern: /^(\d+)-[\da-f-]+\.jsonl$/, cutoff: now - Number(settings.values["audit.retentionDays"]) * 86400000, date: false },
      { directory: path.join(root, "risk", "light", "grants"), pattern: /^\d+-(\d{4}-\d{2}-\d{2})\.json$/, cutoff: now - Number(settings.values["grant.retentionDays"]) * 86400000, date: true },
    ];
    let budget = 100;
    for (const target of targets) {
      let files: string[];
      // These are runtime volume directories, never deployment dependencies.
      try { files = await readdir(/* turbopackIgnore: true */ target.directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
      for (const file of files.sort()) {
        const match = target.pattern.exec(file); if (!match) continue;
        const at = target.date ? Date.parse(`${match[1]}T00:00:00+08:00`) : Number(match[1]);
        if (at >= target.cutoff) continue;
        if (budget-- <= 0) return;
        await unlink(path.join(target.directory, file)).catch(e => { if (e.code !== "ENOENT") throw e; });
      }
    }
  })().finally(() => { running = undefined; });
  return running;
}
