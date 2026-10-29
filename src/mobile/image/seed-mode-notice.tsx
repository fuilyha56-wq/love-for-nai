"use client";

import { LockKeyhole } from "lucide-react";
import "./seed-mode-notice.css";

export function SeedModeNotice({ seed, onRandom }: { seed: string; onRandom: () => void }) {
  const value = Number(seed);
  if (!seed.trim() || !Number.isSafeInteger(value) || value <= 0 || value > 4294967295) return null;
  return <div className="mobile-seed-mode-notice" role="status">
    <span><LockKeyhole size={13} aria-hidden="true" />固定种子 <b>{seed}</b><small>相同参数会复现</small></span>
    <button type="button" onClick={onRandom}>改为随机</button>
  </div>;
}
