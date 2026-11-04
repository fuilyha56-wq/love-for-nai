"use client";

import { useEffect, useState } from "react";
import { retryAfterSeconds } from "@/lib/retry-after";

export function useRequestCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => { const current = Date.now(); setNow(current); if (current >= until) setUntil(0); }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  function observe(response: Response) {
    if (response.status !== 429) return;
    const current = Date.now();
    setNow(current);
    setUntil(current + retryAfterSeconds(response.headers.get("retry-after")) * 1000);
  }
  return { remaining, observe };
}
