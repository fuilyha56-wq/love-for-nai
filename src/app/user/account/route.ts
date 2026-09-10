import { bearerAuthorization, forbiddenUserAccount } from "@/lib/compat-api";

export async function GET(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  return forbiddenUserAccount();
}

export async function POST(request: Request): Promise<Response> {
  return GET(request);
}
