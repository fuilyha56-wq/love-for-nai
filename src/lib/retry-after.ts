export function retryAfterSeconds(value: string | null, now = Date.now(), fallback = 60): number {
  const seconds = value && /^\d+$/.test(value.trim()) ? Number(value)
    : value ? Math.ceil((Date.parse(value) - now) / 1000) : fallback;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : fallback;
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter: number) {
    super(message);
    this.name = "RateLimitError";
  }
}
