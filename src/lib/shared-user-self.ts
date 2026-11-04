import { cachedUpstreamRead } from "@/lib/upstream-read-cache";

/** Coalesce simultaneous account reads, without caching balances or permission decisions. */
export async function fetchNewApiSelf(
  baseUrl: string,
  headers: HeadersInit,
): Promise<Response> {
  return cachedUpstreamRead(`${baseUrl.replace(/\/+$/, "")}/api/user/self`, headers);

}
