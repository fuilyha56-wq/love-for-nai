import { NextResponse } from "next/server";
import { readUserRole } from "@/lib/admin-auth";
import { getSession } from "@/lib/session";

// 前端用：返回当前登录用户是否为 NewAPI 管理员。
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ admin: false });
  const role = await readUserRole(session);
  return NextResponse.json({ admin: typeof role === "number" && role >= 10, role });
}
