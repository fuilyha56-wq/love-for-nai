import { bearerAuthorization, naiSubscriptionResponse } from "@/lib/compat-api";
import { resolveExternalApiIdentity } from "@/lib/newapi-db";
import { externalCorsPreflight, withExternalCors } from "@/lib/external-cors";

export function OPTIONS(): Response {
  return externalCorsPreflight();
}

/** A relay-only summary. Never proxy the upstream account's /user/data. */
export async function GET(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const identity = await resolveExternalApiIdentity(authorization);
  if (identity.userId == null)
    return withExternalCors(Response.json({ message: "无效的 API Key", error: { code: "invalid_api_key", message: "无效的 API Key" } }, { status: 401 }));
  const subscription = await naiSubscriptionResponse(identity.userId);
  return withExternalCors(Response.json({ subscription: await subscription.json() }));
}
