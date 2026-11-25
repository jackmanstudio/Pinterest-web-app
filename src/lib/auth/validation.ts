import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblems, passwordStrength, safeNext, looksLikeEmail } from "./checks";

export { PASSWORD_MAX, PASSWORD_MIN, passwordProblems, passwordStrength, safeNext, looksLikeEmail };

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
