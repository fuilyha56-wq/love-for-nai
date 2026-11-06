import "server-only";

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type VerificationKey = { keyId: string; publicKey: KeyObject };
type SigningKey = VerificationKey & { privateKey: KeyObject };
const keyCache = globalThis as typeof globalThis & {
  __lfnWatermarkV2Key?: { file: string; pending: Promise<SigningKey | null> };
  __lfnWatermarkLegacyKey?: { file: string; pending: Promise<VerificationKey | null> };
};

function keyFile(name: string): string {
  return path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), name);
}

async function readKeyFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function signingKey(pem: string): SigningKey {
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Invalid V2 watermark key type");
  const publicKey = createPublicKey(privateKey);
  const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url");
  return { keyId, privateKey, publicKey };
}

async function loadV2Key(file: string): Promise<SigningKey | null> {
  const stored = await readKeyFile(file);
  if (stored === undefined) return null;
  if (!stored || typeof stored !== "object" || !("privateKey" in stored) || typeof stored.privateKey !== "string")
    throw new Error("Invalid V2 watermark key file");
  return signingKey(stored.privateKey);
}

async function createV2Key(file: string): Promise<SigningKey> {
  const existing = await loadV2Key(file);
  if (existing) return existing;

  const generated = generateKeyPairSync("ed25519");
  const privateKey = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ privateKey }), { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
    // Publish a complete key atomically. Another process may win the race.
    await link(temporary, file);
    return signingKey(privateKey);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = await loadV2Key(file);
    if (!winner) throw error;
    return winner;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function getV2Key(create: boolean): Promise<SigningKey | null> {
  const file = keyFile("watermark-v2-keys.json");
  const cached = keyCache.__lfnWatermarkV2Key;
  if (cached?.file === file) {
    const key = await cached.pending;
    if (key || !create) return key;
    return getV2Key(true);
  }
  const pending = (create ? createV2Key(file) : loadV2Key(file)).then((key) => {
    if (!key && keyCache.__lfnWatermarkV2Key?.pending === pending) keyCache.__lfnWatermarkV2Key = undefined;
    return key;
  }, (error: unknown) => {
    if (keyCache.__lfnWatermarkV2Key?.pending === pending) keyCache.__lfnWatermarkV2Key = undefined;
    throw error;
  });
  keyCache.__lfnWatermarkV2Key = { file, pending };
  return pending;
}

export async function watermarkSigningKey(): Promise<SigningKey> {
  const key = await getV2Key(true);
  if (!key) throw new Error("Missing V2 watermark signing key");
  return key;
}

export async function watermarkVerificationKey(): Promise<VerificationKey | null> {
  const key = await getV2Key(false);
  return key && { keyId: key.keyId, publicKey: key.publicKey };
}

export async function legacyWatermarkVerificationKey(): Promise<VerificationKey | null> {
  const file = keyFile("watermark-keys.json");
  if (keyCache.__lfnWatermarkLegacyKey?.file === file) return keyCache.__lfnWatermarkLegacyKey.pending;
  const pending = readKeyFile(file).then((stored) => {
    if (stored === undefined) {
      if (keyCache.__lfnWatermarkLegacyKey?.pending === pending) keyCache.__lfnWatermarkLegacyKey = undefined;
      return null;
    }
    if (!stored || typeof stored !== "object" || !("publicKey" in stored) || typeof stored.publicKey !== "string")
      throw new Error("Invalid legacy watermark verification key file");
    const publicKey = createPublicKey(stored.publicKey);
    if (publicKey.asymmetricKeyType !== "rsa") throw new Error("Invalid legacy watermark key type");
    const keyId = "keyId" in stored && typeof stored.keyId === "string" && stored.keyId
      ? stored.keyId : createHash("sha256").update(stored.publicKey).digest("hex").slice(0, 16);
    return { keyId, publicKey };
  }).catch((error: unknown) => {
    if (keyCache.__lfnWatermarkLegacyKey?.pending === pending) keyCache.__lfnWatermarkLegacyKey = undefined;
    throw error;
  });
  keyCache.__lfnWatermarkLegacyKey = { file, pending };
  return pending;
}
