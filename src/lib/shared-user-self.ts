import { createHash } from "node:crypto";

const runtime = globalThis as typeof globalThis & {
  __lfnSelfRequests?: Map<string, Promise<Response>>;
};
const requests = (runtime.__lfnSelfRequests ??= new Map<
  string,
  Promise<Response>
>());

/** Coalesce simultaneous account reads, without caching balances or permission decisions. */
export async function fetchNewApiSelf(
  baseUrl: string,
  headers: HeadersInit,
): Promise<Response> {
  const normalized = new Headers(headers);
  const url = `${baseUrl.replace(/\/+$/, "")}/api/user/self`;
  const key = createHash("sha256")
    .update(JSON.stringify([url, [...normalized.entries()].sort()]))
    .digest("hex");
  let pending = requests.get(key);
  if (!pending) {
    pending = fetch(url, {
      headers: normalized,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).then(
      async (response) =>
        new Response(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
    );
    requests.set(key, pending);
  }
  try {
    return (await pending).clone();
  } finally {
    if (requests.get(key) === pending) requests.delete(key);
  }
}
