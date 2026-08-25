import { proxyNewApi } from "@/lib/compat-api";

export async function POST(request: Request): Promise<Response> {
  return proxyNewApi(request, "/v1/images/edits");
}