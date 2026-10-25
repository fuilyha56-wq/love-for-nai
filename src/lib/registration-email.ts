import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import type { RuntimeSettings } from "@/lib/runtime-config";

type Challenge = {
  salt: string;
  hash: string;
  expiresAt: number;
  attempts: number;
};
const shared = globalThis as typeof globalThis & {
  __lfnEmailLock?: Promise<unknown>;
};
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = (shared.__lfnEmailLock || Promise.resolve()).then(task, task);
  shared.__lfnEmailLock = current.catch(() => undefined);
  return current;
}
function challengePath(email: string) {
  return path.join(
    path.resolve(process.env.LFN_DATA_DIR || "data"),
    "registration-email",
    `${createHash("sha256").update(email.toLowerCase()).digest("hex")}.json`,
  );
}
const digest = (code: string, salt: string) =>
  createHash("sha256").update(`${salt}:${code}`).digest("hex");
async function save(file: string, challenge: Challenge) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(challenge), { mode: 0o600 });
  await rename(temporary, file);
}

export function smtpConfigured(settings: RuntimeSettings) {
  return Boolean(settings.smtpHost && settings.smtpFrom);
}

export async function sendRegistrationEmail(
  settings: RuntimeSettings,
  email: string,
) {
  if (!smtpConfigured(settings))
    throw new Error("请先在注册与登录设置中配置 SMTP 邮件服务");
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    requireTLS: !settings.smtpSecure,
    auth: settings.smtpUser
      ? { user: settings.smtpUser, pass: settings.smtpPassword }
      : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return withLock(async () => {
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(24).toString("hex");
    // Publish the challenge only after the mail server accepts delivery.
    await transport.sendMail({
      from: settings.smtpFrom,
      to: email,
      subject: "LFN 注册邮箱验证码",
      text: `你的 LFN 注册验证码是：${code}\n验证码 10 分钟内有效。若非本人操作，请忽略此邮件。`,
    });
    await save(challengePath(email), {
      salt,
      hash: digest(code, salt),
      expiresAt: Date.now() + 600_000,
      attempts: 0,
    });
  });
}

export async function consumeRegistrationEmail(
  email: string,
  code: string,
): Promise<boolean> {
  return withLock(async () => {
    const file = challengePath(email);
    let challenge: Challenge;
    try {
      challenge = JSON.parse(await readFile(file, "utf8")) as Challenge;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (challenge.expiresAt <= Date.now() || challenge.attempts >= 5)
      return false;
    const valid =
      /^\d{6}$/.test(code) &&
      timingSafeEqual(
        Buffer.from(challenge.hash, "hex"),
        Buffer.from(digest(code, challenge.salt), "hex"),
      );
    // Persist failed attempts and successful consumption; codes cannot be replayed.
    await save(file, {
      ...challenge,
      attempts: challenge.attempts + 1,
      expiresAt: valid ? 0 : challenge.expiresAt,
    });
    return valid;
  });
}
