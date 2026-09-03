import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { getRuntimeSettings } from "@/lib/runtime-config";

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
const PUBLIC_PLACEHOLDER_SECRET = "replace-with-at-least-32-random-bytes";

// 弱密钥会让攻击者伪造任意 userId 的会话，生产环境必须拒绝启动。
export function validateSessionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const configured = environment.LFN_SESSION_SECRET || "";
  if (environment.NODE_ENV === "production") {
    if (!configured)
      throw new Error("LFN_SESSION_SECRET is required in production");
    if (Buffer.byteLength(configured, "utf8") < 32)
      throw new Error("LFN_SESSION_SECRET must be at least 32 bytes");
    if (
      configured === DEVELOPMENT_SECRET ||
      configured === PUBLIC_PLACEHOLDER_SECRET
    )
      throw new Error(
        "LFN_SESSION_SECRET must not use a public or development default",
      );
  }
}

function secret(): string {
  validateSessionConfiguration();
  const configured = process.env.LFN_SESSION_SECRET || "";
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

function cookieOptions(secure = process.env.LFN_COOKIE_SECURE === "true") {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: { ...cookieOptions(), maxAge: 604800 },
};

export const pendingCookie = {
  name: PENDING_COOKIE_NAME,
  options: { ...cookieOptions(), maxAge: 300 },
};

export async function resolvedSessionCookie() {
  const settings = await getRuntimeSettings().catch(() => null);
  return {
    name: COOKIE_NAME,
    options: { ...cookieOptions(settings?.cookieSecure === true), maxAge: 604800 },
  };
}

export async function resolvedPendingCookie() {
  const settings = await getRuntimeSettings().catch(() => null);
  return {
    name: PENDING_COOKIE_NAME,
    options: { ...cookieOptions(settings?.cookieSecure === true), maxAge: 300 },
  };
}
