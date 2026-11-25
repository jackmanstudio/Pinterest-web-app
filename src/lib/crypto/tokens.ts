import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM (authenticated encryption) for OAuth tokens at rest.
 * Key: 32 random bytes, base64 (`openssl rand -base64 32`), kept in the
 * server environment, never in the database.
 *
 * Format v2: v2.<keyId>.<iv>.<tag>.<ciphertext>. The key id (first 8 hex of
 * SHA-256 of the key) lets old tokens be read during a key rotation:
 *   1. set TOKEN_ENCRYPTION_KEY_PREVIOUS to the old key, TOKEN_ENCRYPTION_KEY to a new one;
 *   2. call /api/cron/rotate-token-key (or just let tokens re-encrypt on their next use);
 *   3. remove TOKEN_ENCRYPTION_KEY_PREVIOUS.
 * v1 (no key id) is still readable.
 */
function key(keyB64: string): Buffer {
  const k = Buffer.from(keyB64, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function keyId(keyB64: string): string {
  return createHash("sha256").update(key(keyB64)).digest("hex").slice(0, 8);
}

/** Old keys still accepted for reading (comma-separated TOKEN_ENCRYPTION_KEY_PREVIOUS). */
export function previousKeys(env: Record<string, string | undefined> = process.env): string[] {
  return (env.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function encryptToken(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v2", keyId(keyB64), iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

function open(keyB64: string, iv: string, tag: string, ct: string): string {
  const d = createDecipheriv("aes-256-gcm", key(keyB64), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export function decryptToken(enc: string, keyB64: string, previous: string[] = previousKeys()): string {
  const parts = enc.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, kid, iv, tag, ct] = parts;
    const k = [keyB64, ...previous].find((x) => keyId(x) === kid);
    if (!k) throw new Error("Token was encrypted with a key that is no longer configured");
    return open(k, iv, tag, ct);
  }
  if (parts[0] === "v1" && parts.length === 4) {
    const [, iv, tag, ct] = parts;
    let last: unknown;
    for (const k of [keyB64, ...previous]) {
      try {
        return open(k, iv, tag, ct);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
  throw new Error("Unrecognised token format");
}

/** True when the value should be re-encrypted with the current key (old format or old key). */
export function needsReencrypt(enc: string, keyB64: string): boolean {
  const parts = enc.split(".");
  return parts[0] !== "v2" || parts[1] !== keyId(keyB64);
}
