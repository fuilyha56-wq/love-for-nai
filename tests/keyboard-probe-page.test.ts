import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/diagnostics/keyboard/route";
import { keyboardProbePage } from "@/lib/keyboard-probe-page";
import {
  VIEWPORT_DIAGNOSTIC_BOUNDS, VIEWPORT_DIAGNOSTIC_COLUMNS, VIEWPORT_DIAGNOSTIC_DURATION_MS,
  VIEWPORT_DIAGNOSTIC_MAX_BYTES, VIEWPORT_DIAGNOSTIC_MAX_ROWS,
} from "@/lib/viewport-diagnostic-schema";

describe("independent keyboard probe document", () => {
  it.each([
    ["", "resizes-content"], ["?mode=content", "resizes-content"],
    ["?mode=overlay", "overlays-content"], ["?mode=%3Cscript%3E", "resizes-content"],
  ])("allowlists the viewport policy for %s", async (query, expected) => {
    const response = GET(new Request(`https://example.test/diagnostics/keyboard${query}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html.match(/<meta name="viewport"[^>]+>/g)).toHaveLength(1);
    expect(html).toContain(`interactive-widget=${expected}`);
    expect(html).not.toContain("/_next/");
  });

  it.each(["content", "overlay"] as const)("generates parseable %s script using the unchanged numeric schema limits", mode => {
    const html = keyboardProbePage(mode);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Script(script!)).not.toThrow();
    const config = JSON.parse(script!.match(/const config = (\{[^\n]+\});/)![1]);
    expect(config.bounds).toEqual(VIEWPORT_DIAGNOSTIC_BOUNDS);
    expect(config.bounds).toHaveLength(VIEWPORT_DIAGNOSTIC_COLUMNS.length);
    expect(config.bounds).toHaveLength(59);
    expect(config.duration).toBe(VIEWPORT_DIAGNOSTIC_DURATION_MS);
    expect(config.maxBytes).toBe(VIEWPORT_DIAGNOSTIC_MAX_BYTES);
    expect(config.maxRows).toBe(VIEWPORT_DIAGNOSTIC_MAX_ROWS);
    expect(config.mode).toBe(mode);
    expect(html).toContain('id="record" type="button" disabled');
    expect(html).toContain('height:100dvh');
    expect(html).toContain('padding-bottom:env(keyboard-inset-height,0px)');
  });
});
