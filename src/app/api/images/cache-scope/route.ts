import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ scope: session ? `user:${session.userId}` : "guest" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
