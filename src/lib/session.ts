import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type LfnSession = {
  userId: number;
  username: string;
  displayName: string;
  upstreamCookie: string;
  expiresAt: number;
};
const COOKIE_NAME = "lfn_session";
const secret = () =>
  process.env.LFN_SESSION_SECRET || "lfn-development-secret-change-me";
const sign = (value: string) =>
  createHmac("sha256", secret()).update(value).digest("base64url");

export function encodeSession(session: LfnSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw?: string): LfnSession | null {
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as LfnSession;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<LfnSession | null> {
  return decodeSession((await cookies()).get(COOKIE_NAME)?.value);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 604800,
  },
};
