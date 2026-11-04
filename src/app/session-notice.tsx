"use client";

import Link from "next/link";

export { readJson, SessionExpiredError } from "@/lib/client-json";

export function SessionExpiredNotice({ message }: { message: string }) {
  return (
    <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p>{message}</p>
      <Link
        href="/sign-in"
        className="mt-2 inline-flex h-8 items-center rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
      >
        重新登录
      </Link>
    </div>
  );
}
