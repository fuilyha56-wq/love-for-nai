import { NextResponse } from "next/server";
import { getRuntimeModelPolicy } from "@/lib/runtime-config";

export async function GET() {
  const policy = await getRuntimeModelPolicy();
  return NextResponse.json(policy, {
    headers: { "Cache-Control": "no-store" },
  });
}
