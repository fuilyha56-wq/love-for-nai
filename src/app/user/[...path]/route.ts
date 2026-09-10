import { bearerAuthorization, forbiddenUserAccount } from "@/lib/compat-api";

async function reject(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  return forbiddenUserAccount();
}

export async function GET(request: Request): Promise<Response> {
  return reject(request);
}

export async function POST(request: Request): Promise<Response> {
  return reject(request);
}

export async function PUT(request: Request): Promise<Response> {
  return reject(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return reject(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return reject(request);
}
