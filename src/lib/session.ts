import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
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
const encryptionKey = () => createHash("sha256").update(secret()).digest();

export function encodeSession(session: LfnSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decodeSession(raw?: string): LfnSession | null {
  if (!raw) return null;
  try {
    const [ivRaw, tagRaw, encryptedRaw] = raw.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]);
    const session = JSON.parse(decrypted.toString("utf8")) as LfnSession;
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
    secure: process.env.LFN_COOKIE_SECURE === "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 604800,
  },
};
