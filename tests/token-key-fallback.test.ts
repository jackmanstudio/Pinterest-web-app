import { describe, expect, it } from "vitest";
import { checkPinterestConfig, getPinterestConfig, tokenEncryptionKey } from "@/lib/pinterest/config";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";

const BASE = {
  PINTEREST_CLIENT_ID: "id", PINTEREST_CLIENT_SECRET: "secret", PINTEREST_REDIRECT_URI: "https://x/cb",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc",
};
const COOKIE = "c".repeat(48);

describe("token encryption key fallback", () => {
  it("prefers TOKEN_ENCRYPTION_KEY when set", () => {
    expect(tokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: "explicit", AUTH_COOKIE_SECRET: COOKIE })).toBe("explicit");
  });
  it("derives a stable 32-byte key from AUTH_COOKIE_SECRET", () => {
    const k = tokenEncryptionKey({ AUTH_COOKIE_SECRET: COOKIE })!;
    expect(Buffer.from(k, "base64")).toHaveLength(32);
    expect(tokenEncryptionKey({ AUTH_COOKIE_SECRET: COOKIE })).toBe(k);
    expect(k).not.toBe(tokenEncryptionKey({ AUTH_COOKIE_SECRET: "d".repeat(48) }));
    expect(decryptToken(encryptToken("tok", k), k)).toBe("tok");
  });
  it("needs a long enough cookie secret", () => {
    expect(tokenEncryptionKey({ AUTH_COOKIE_SECRET: "short" })).toBeNull();
    expect(checkPinterestConfig({ ...BASE }).missing).toEqual(["TOKEN_ENCRYPTION_KEY"]);
  });
  it("config is ready without TOKEN_ENCRYPTION_KEY when the cookie secret exists", () => {
    const env = { ...BASE, AUTH_COOKIE_SECRET: COOKIE };
    expect(checkPinterestConfig(env).ready).toBe(true);
    expect(getPinterestConfig(env).encryptionKey).toBe(tokenEncryptionKey(env));
  });
});
