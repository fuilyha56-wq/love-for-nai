import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false });
  try {
    const upstream = await fetch(`${process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000"}/api/user/self`, {
      headers: { Cookie: session.upstreamCookie, "New-Api-User": String(session.userId) }, cache: "no-store",
    });
    const result = await upstream.json();
    if (!result.success) return NextResponse.json({ authenticated: false }, { status: 401 });
    const user = result.data;
    return NextResponse.json({ authenticated: true, user: { id: user.id, name: user.display_name || user.username, group: user.group, balance: Number(user.quota || 0) / Number(process.env.QUOTA_PER_UNIT || 500000) } });
  } catch { return NextResponse.json({ authenticated: true, user: { id: session.userId, name: session.displayName, group: "未知", balance: null } }); }
}