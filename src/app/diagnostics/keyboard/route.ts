import { keyboardProbePage } from "@/lib/keyboard-probe-page";

/** A separate document: it does not load the application's layout or viewport hooks. */
export function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("mode");
  const mode = requested === "overlay" || requested === "native" ? requested : "content";
  return new Response(keyboardProbePage(mode), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
