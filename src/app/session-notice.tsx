"use client";

import Link from "next/link";

// 后端在会话失效时返回 sessionExpired，前端据此引导重新登录而不是只显示错误。
export class SessionExpiredError extends Error {}

export async function readJson<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const result = await response.json();
  if (response.ok) return result as T;
  if (response.status === 401 || result?.sessionExpired)
    throw new SessionExpiredError(result?.message || "登录状态已过期");
  throw new Error(result?.message || fallback);
}

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
