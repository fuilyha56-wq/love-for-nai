import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/runtime-config";

export type LfnSession = {
  userId: number;
  username: string;
  displayName: string;
  upstreamCookie: string;
  accessToken?: string;
  // 系统访问令牌长期有效，与登录派发的 access_token 鉴权方式不同。
  systemToken?: string;
  expiresAt: number;
  // 会话纪元：管理员清理全部登录状态时递增，旧纪元 cookie 立即失效。
  epoch?: number;
  // 用户会话纪元：密码修改等安全操作只撤销该用户全部设备。
  userEpoch?: number;
};
// 2FA 第一步与第二步之间的临时状态，只保存上游 flow_token。
export type LfnPendingSession = {
  flowToken: string;
  expiresAt: number;
  // 登录时勾选「保持登录」后，正式会话延长到 30 天。
  remember?: boolean;
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

export async function encodeSession(session: LfnSession): Promise<string> {
  const [epoch, userEpoch] = await Promise.all([
    currentSessionEpoch(),
    currentUserSessionEpoch(session.userId),
  ]);
  return encodeWithEpoch(session, epoch, userEpoch);
}

function encodeWithEpoch(session: LfnSession, epoch: number, userEpoch: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ ...session, epoch, userEpoch }), "utf8"),
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

// 会话纪元默认 1：不带纪元字段的旧 cookie（部署前签发）判定为旧纪元，
// 部署本版本即等效于清空全部站内登录状态。
const SESSION_EPOCH_DEFAULT = 1;
export const SESSION_MAX_AGE = 604_800; // 7 天
export const KEEP_LOGIN_MAX_AGE = 2_592_000; // 保持登录 30 天

export function keepLoginTtlMs(remember: boolean): number {
  return remember ? 2_592_000_000 : 604_800_000;
}

async function currentSessionEpoch(): Promise<number> {
  const settings = await getRuntimeSettings().catch(() => null);
  const epoch = settings?.sessionEpoch;
  return typeof epoch === "number" &&
    Number.isFinite(epoch) &&
    epoch >= SESSION_EPOCH_DEFAULT
    ? Math.floor(epoch)
    : SESSION_EPOCH_DEFAULT;
}

async function currentUserSessionEpoch(userId: number): Promise<number> {
  const settings = await getRuntimeSettings().catch(() => null);
  const epoch = settings?.sessionEpochs?.[String(userId)];
  return typeof epoch === "number" && Number.isFinite(epoch) && epoch >= SESSION_EPOCH_DEFAULT
    ? Math.floor(epoch)
    : SESSION_EPOCH_DEFAULT;
}

export async function revokeUserSessions(userId: number): Promise<number> {
  const settings = await getRuntimeSettings();
  const key = String(userId);
  const current = await currentUserSessionEpoch(userId);
  const sessionEpochs = { ...settings.sessionEpochs, [key]: current + 1 };
  await updateRuntimeSettings({ sessionEpochs });
  return current + 1;
}

async function validDecodedSession(raw?: string): Promise<LfnSession | null> {
  const decoded = decodeSession(raw);
  if (!decoded) return null;
  // 纪元不一致（含未带纪元字段的旧 cookie）一律视为已失效。
  if ((decoded.epoch ?? 0) !== (await currentSessionEpoch())) return null;
  if ((decoded.userEpoch ?? 0) !== (await currentUserSessionEpoch(decoded.userId))) return null;
  return decoded;
}

export async function getSession(): Promise<LfnSession | null> {
  return validDecodedSession((await cookies()).get(COOKIE_NAME)?.value);
}

export function encodePendingSession(pending: LfnPendingSession): Promise<string> {
  return encodeSession(pending as unknown as LfnSession);
}

export async function getPendingSession(): Promise<LfnPendingSession | null> {
  const raw = (await cookies()).get(PENDING_COOKIE_NAME)?.value;
  const decoded = (await validDecodedSession(raw)) as unknown as
    | LfnPendingSession
    | null;
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
  options: { ...cookieOptions(), maxAge: SESSION_MAX_AGE },
};

export const pendingCookie = {
  name: PENDING_COOKIE_NAME,
  options: { ...cookieOptions(), maxAge: 300 },
};

export async function resolvedSessionCookie(remember = false) {
  const settings = await getRuntimeSettings().catch(() => null);
  return {
    name: COOKIE_NAME,
    options: {
      ...cookieOptions(settings?.cookieSecure === true),
      maxAge: remember ? KEEP_LOGIN_MAX_AGE : SESSION_MAX_AGE,
    },
  };
}

export async function resolvedPendingCookie() {
  const settings = await getRuntimeSettings().catch(() => null);
  return {
    name: PENDING_COOKIE_NAME,
    options: { ...cookieOptions(settings?.cookieSecure === true), maxAge: 300 },
  };
}
