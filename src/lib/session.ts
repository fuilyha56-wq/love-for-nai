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
  accessToken?: string;
  // 系统访问令牌长期有效，与登录派发的 access_token 鉴权方式不同。
  systemToken?: string;
  expiresAt: number;
};
// 2FA 第一步与第二步之间的临时状态，只保存上游 flow_token。
export type LfnPendingSession = {
  flowToken: string;
  expiresAt: number;
};
const COOKIE_NAME = "lfn_session";
const PENDING_COOKIE_NAME = "lfn_2fa";
const DEVELOPMENT_SECRET = "lfn-development-secret-change-me";

// 弱密钥会让攻击者伪造任意 userId 的会话，生产环境必须拒绝启动。
function secret(): string {
  const configured = process.env.LFN_SESSION_SECRET || "";
  if (process.env.NODE_ENV === "production") {
    if (!configured)
      throw new Error("LFN_SESSION_SECRET is required in production");
    if (Buffer.byteLength(configured, "utf8") < 32)
      throw new Error("LFN_SESSION_SECRET must be at least 32 bytes");
    if (configured === DEVELOPMENT_SECRET)
      throw new Error("LFN_SESSION_SECRET must not use the development default");
  }
  return configured || DEVELOPMENT_SECRET;
}

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

export function encodePendingSession(pending: LfnPendingSession): string {
  return encodeSession(pending as unknown as LfnSession);
}

export async function getPendingSession(): Promise<LfnPendingSession | null> {
  const raw = (await cookies()).get(PENDING_COOKIE_NAME)?.value;
  const decoded = decodeSession(raw) as unknown as LfnPendingSession | null;
  return decoded?.flowToken ? decoded : null;
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.LFN_COOKIE_SECURE === "true",
  sameSite: "lax" as const,
  path: "/",
};

export const sessionCookie = {
  name: COOKIE_NAME,
  options: { ...cookieOptions, maxAge: 604800 },
};

export const pendingCookie = {
  name: PENDING_COOKIE_NAME,
  options: { ...cookieOptions, maxAge: 300 },
};
