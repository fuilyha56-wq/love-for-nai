import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";
import type { Session } from "@/lib/newapi";

// NewAPI 角色值：1 普通用户，10 管理员，100 root。
export const ROLE_ADMIN = 10;
export const ROLE_ROOT = 100;

type SelfResult = {
  success?: boolean;
  data?: { role?: number; user?: { role?: number } } & { role?: number };
};

export async function readUserRole(
  session: Session,
): Promise<number | null> {
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/self`, {
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await upstream.json()) as SelfResult;
    if (!upstream.ok || !result.success) return null;
    const data = result.data;
    return data?.user?.role ?? data?.role ?? null;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<
  { session: Session; role: number } | { error: string }
> {
  const session = await getSession();
  if (!session) return { error: "请先登录" };
  const role = await readUserRole(session);
  if (role === null) return { error: "无法确认账号角色" };
  if (role < ROLE_ADMIN) return { error: "仅管理员可用" };
  return { session, role };
}

export function isAdminRole(role: number | null | undefined): boolean {
  return typeof role === "number" && role >= ROLE_ADMIN;
}

// LFN 服务级管理令牌：用于注册后把新用户划入 Draw 分组等
// 需要管理员权限的操作。对应 NewAPI root 用户的系统访问令牌。
export function adminToken(): string | null {
  const token = process.env.LFN_ADMIN_TOKEN?.trim();
  return token || null;
}

export function adminHeaders(): Record<string, string> {
  const token = adminToken();
  if (!token) throw new Error("LFN_ADMIN_TOKEN 未配置");
  return {
    Authorization: token,
    "New-Api-User": process.env.LFN_ADMIN_USER_ID || "1",
    "Content-Type": "application/json",
  };
}
