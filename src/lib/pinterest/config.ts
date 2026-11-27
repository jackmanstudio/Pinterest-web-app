/**
 * Pinterest API v5 configuration (verified against the official docs and
 * OpenAPI spec, Nov 2026):
 *  - authorize: https://www.pinterest.com/oauth/
 *  - token:     POST {api}/v5/oauth/token, HTTP Basic client_id:client_secret
 *  - sandbox:   api-sandbox.pinterest.com (Trial apps: created content is
 *               visible only to you); production needs Standard access.
 */
import { hkdfSync } from "node:crypto";

export type PinterestEnv = "sandbox" | "production";

/** Read-only scopes by default. */
export const DEFAULT_SCOPES = ["user_accounts:read", "boards:read", "pins:read"];
/** Added only when PINTEREST_ENABLE_PUBLISHING=true (required by POST /v5/pins). */
export const PUBLISHING_SCOPES = ["boards:write", "pins:write"];

export interface PinterestConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  env: PinterestEnv;
  scopes: string[];
  apiBase: string;
  tokenUrl: string;
  authorizeUrl: string;
  encryptionKey: string;
}

export interface ConfigCheck {
  ready: boolean;
  missing: string[];
  env: PinterestEnv;
}

type Env = Record<string, string | undefined>;

/**
 * The key that encrypts stored Pinterest tokens: TOKEN_ENCRYPTION_KEY when set,
 * otherwise one derived (HKDF-SHA256) from AUTH_COOKIE_SECRET so nobody has to
 * make one by hand. Changing AUTH_COOKIE_SECRET then means reconnecting
 * Pinterest. To switch to an explicit key later, put the derived one in
 * TOKEN_ENCRYPTION_KEY_PREVIOUS (or just reconnect).
 */
export function tokenEncryptionKey(env: Env = process.env): string | null {
  if (env.TOKEN_ENCRYPTION_KEY) return env.TOKEN_ENCRYPTION_KEY;
  const seed = env.AUTH_COOKIE_SECRET;
  if (!seed || seed.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", seed, "pin-ai-studio", "pinterest-token-key-v1", 32)).toString("base64");
}

export function pinterestEnv(env: Env = process.env): PinterestEnv {
  return env.PINTEREST_ENV === "production" ? "production" : "sandbox";
}

export function checkPinterestConfig(env: Env = process.env): ConfigCheck {
  const required = [
    "PINTEREST_CLIENT_ID",
    "PINTEREST_CLIENT_SECRET",
    "PINTEREST_REDIRECT_URI",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missing = required.filter((k) => !env[k]);
  if (!tokenEncryptionKey(env)) missing.splice(3, 0, "TOKEN_ENCRYPTION_KEY");
  return { ready: missing.length === 0, missing, env: pinterestEnv(env) };
}

export function getPinterestConfig(env: Env = process.env): PinterestConfig {
  const check = checkPinterestConfig(env);
  if (!check.ready) throw new Error(`Pinterest is not configured. Missing: ${check.missing.join(", ")}`);
  const host = check.env === "sandbox" ? "https://api-sandbox.pinterest.com" : "https://api.pinterest.com";
  const scopes = env.PINTEREST_SCOPES
    ? env.PINTEREST_SCOPES.split(/[\s,]+/).filter(Boolean)
    : env.PINTEREST_ENABLE_PUBLISHING === "true"
      ? [...DEFAULT_SCOPES, ...PUBLISHING_SCOPES]
      : DEFAULT_SCOPES;
  return {
    clientId: env.PINTEREST_CLIENT_ID!,
    clientSecret: env.PINTEREST_CLIENT_SECRET!,
    redirectUri: env.PINTEREST_REDIRECT_URI!,
    env: check.env,
    scopes,
    apiBase: `${host}/v5`,
    tokenUrl: `${host}/v5/oauth/token`,
    authorizeUrl: "https://www.pinterest.com/oauth/",
    encryptionKey: tokenEncryptionKey(env)!,
  };
}

export function buildAuthorizeUrl(cfg: PinterestConfig, state: string): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scopes.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}
