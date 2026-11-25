import { z } from "zod";

/**
 * Shared auth rules (spec 12). Used by the forms for instant feedback and
 * again by the server routes, which are the real gate.
 */

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email is too long.")
  .email("Enter a valid email address.");

export const NameSchema = z.string().trim().min(2, "Enter your full name.").max(100, "Keep your name under 100 characters.");

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

export const PasswordSchema = z.string().min(1, "Enter a password.").max(200);

export const SignupSchema = z
  .object({
    fullName: NameSchema,
    email: EmailSchema,
    password: PasswordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { message: "Please accept the Terms of Service and Privacy Policy." }),
  })
  .superRefine((v, ctx) => {
    const p = passwordProblems(v.password, { email: v.email, name: v.fullName });
    if (p.length) ctx.addIssue({ code: "custom", path: ["password"], message: `Password needs: ${p.join(", ").toLowerCase()}.` });
    if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "The passwords don't match." });
  });

export const LoginSchema = z.object({ email: EmailSchema, password: PasswordSchema, remember: z.boolean().default(true) });
export const ForgotSchema = z.object({ email: EmailSchema });
export const NewPasswordSchema = z
  .object({ password: PasswordSchema, confirmPassword: z.string(), currentPassword: z.string().max(200).optional() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match." });

/** Field → first error message, for showing next to each input. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= i.message;
  }
  return out;
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

/**
 * Generic auth error text: never says whether an email is registered
 * (prevents account enumeration).
 */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the verification link.";
  if (m.includes("invalid login") || m.includes("invalid credentials") || m.includes("invalid grant")) return "Email or password is incorrect.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("weak") || m.includes("pwned") || m.includes("leaked")) return "This password is too weak or has appeared in a data breach. Choose another.";
  if (m.includes("same") && m.includes("password")) return "Choose a password you haven't used here before.";
  if (m.includes("expired") || m.includes("otp") || m.includes("invalid flow") || m.includes("code verifier")) return "This link has expired or was already used. Request a new one.";
  return "Something went wrong. Please try again.";
}
