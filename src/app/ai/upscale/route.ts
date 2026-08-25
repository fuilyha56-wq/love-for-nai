import { unsupportedNaiOperation } from "@/lib/compat-api";

export async function POST(request: Request): Promise<Response> {
  return unsupportedNaiOperation(request, "upscale");
}