import { NextResponse } from "next/server";
import { resolvedPendingCookie, resolvedSessionCookie } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  const [sessionCookie, pendingCookie] = await Promise.all([
    resolvedSessionCookie(),
    resolvedPendingCookie(),
  ]);
  for (const cookie of [sessionCookie, pendingCookie])
    response.cookies.set(cookie.name, "", { ...cookie.options, maxAge: 0 });
  return response;
}
