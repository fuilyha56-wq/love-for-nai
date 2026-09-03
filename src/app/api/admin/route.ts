import { NextResponse } from "next/server";
import { readUserRole } from "@/lib/admin-auth";
import { listAdminModules } from "@/lib/admin-modules";
import { getPlatformCapabilities } from "@/lib/platform";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  const capabilities = getPlatformCapabilities();
  if (!session)
    return NextResponse.json({
      admin: false,
      capabilities,
      modules: listAdminModules(capabilities),
    });
  const role = await readUserRole(session);
  return NextResponse.json({
    admin: typeof role === "number" && role >= 10,
    role,
    capabilities,
    modules: listAdminModules(capabilities),
  });
}
