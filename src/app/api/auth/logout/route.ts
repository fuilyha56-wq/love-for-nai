import { NextResponse } from "next/server";
import { pendingCookie, sessionCookie } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  for (const cookie of [sessionCookie, pendingCookie])
    response.cookies.set(cookie.name, "", { ...cookie.options, maxAge: 0 });
  return response;
}
