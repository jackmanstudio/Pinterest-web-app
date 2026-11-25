/**
 * Auth checks with no dependencies, safe to ship to the browser on the sign-in
 * pages without pulling in zod. The server still validates with the zod schemas
 * in ./validation, which re-exports these.
 */

/** Quick shape check for the browser. The server's EmailSchema is the real gate. */
export function looksLikeEmail(v: string): boolean {
  const s = v.trim();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // bcrypt (Supabase Auth) only uses the first 72 bytes.

const COMMON = new Set([
  "password", "password1", "password123", "123456789", "1234567890", "qwerty123", "qwertyuiop", "iloveyou", "letmein123", "welcome123",
  "admin12345", "abc123456", "pinterest", "pinterest1", "11111111111", "000000000000", "passw0rd", "p@ssw0rd", "changeme123",
]);

/** Plain-language rules for a strong password. Empty list = OK. */
export function passwordProblems(pw: string, ctx: { email?: string; name?: string } = {}): string[] {
  const out: string[] = [];
  if (pw.length < PASSWORD_MIN) out.push(`At least ${PASSWORD_MIN} characters`);
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX) out.push(`At most ${PASSWORD_MAX} characters`);
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) out.push("Upper- and lower-case letters");
  if (!/[0-9]/.test(pw)) out.push("At least one number");
  if (!/[^A-Za-z0-9]/.test(pw)) out.push("At least one symbol (e.g. ! ? # @)");
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw)) out.push("Not a common or repeated password");
  const local = ctx.email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) out.push("Doesn't contain your email name");
  const first = ctx.name?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (first.length >= 4 && lower.includes(first)) out.push("Doesn't contain your name");
  return out;
}

/** 0-4 strength meter for the UI. */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= PASSWORD_MIN) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return passwordProblems(pw).length ? Math.min(s, 2) : Math.max(s, 3);
}


/**
 * Only same-site relative paths are allowed after sign-in, so a crafted
 * ?next= link can't send someone to another website (open redirect).
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  if (/^\/(login|signup|forgot-password|auth\/|api\/)/.test(next)) return fallback;
  return next.slice(0, 500);
}

