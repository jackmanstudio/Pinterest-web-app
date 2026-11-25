import { describe, expect, it } from "vitest";
import { LoginSchema, SignupSchema, fieldErrors, friendlyAuthError, passwordProblems, passwordStrength, safeNext } from "@/lib/auth/validation";
import { rememberOptions } from "@/lib/supabase/remember";
import { signRecovery, verifyRecovery } from "@/lib/auth/server";

describe("password rules", () => {
  it("accepts a strong password", () => {
    expect(passwordProblems("Blue-Tulip-42-Sky")).toEqual([]);
    expect(passwordStrength("Blue-Tulip-42-Sky")).toBeGreaterThanOrEqual(3);
  });
  it("explains what is missing", () => {
    const p = passwordProblems("short");
    expect(p).toContain("At least 10 characters");
    expect(p).toContain("At least one number");
  });
  it("rejects common passwords and ones containing the email name", () => {
    expect(passwordProblems("Password123")).not.toEqual([]);
    expect(passwordProblems("Ayesha#2026xx", { email: "ayesha@example.com" })).toContain("Doesn't contain your email name");
  });
  it("respects bcrypt's 72-byte limit", () => {
    expect(passwordProblems("Aa1!" + "x".repeat(80))).toContain("At most 72 characters");
  });
});

describe("signup validation", () => {
  const ok = { fullName: "Ayesha Khan", email: "A@Example.com ", password: "Blue-Tulip-42-Sky", confirmPassword: "Blue-Tulip-42-Sky", acceptTerms: true };
  it("normalises email", () => {
    expect(SignupSchema.parse(ok).email).toBe("a@example.com");
  });
  it("requires matching passwords, terms and a valid email", () => {
    const r = SignupSchema.safeParse({ ...ok, email: "nope", acceptTerms: false });
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["acceptTerms", "email"]);
    const m = SignupSchema.safeParse({ ...ok, confirmPassword: "x" });
    expect(Object.keys(fieldErrors(m.error!))).toEqual(["confirmPassword"]);
    const w = SignupSchema.safeParse({ ...ok, password: "weak", confirmPassword: "weak" });
    expect(fieldErrors(w.error!).password).toMatch(/Password needs/);
  });
  it("login defaults remember to true", () => {
    expect(LoginSchema.parse({ email: "a@b.co", password: "x" }).remember).toBe(true);
  });
});

describe("safe redirects after sign-in", () => {
  it("keeps same-site paths", () => expect(safeNext("/w/macro/boards?x=1")).toBe("/w/macro/boards?x=1"));
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/login", "/api/auth/login", null])("blocks %s", (v) => {
    expect(safeNext(v as string | null)).toBe("/w/fashion");
  });
});

describe("auth messages don't reveal accounts", () => {
  it("uses one message for wrong email or password", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe("Email or password is incorrect.");
  });
  it("never echoes raw provider text", () => {
    expect(friendlyAuthError("Database error saving new user: xyz")).toBe("Something went wrong. Please try again.");
  });
});

describe("remember me", () => {
  it("drops max-age when off, keeps removals", () => {
    expect(rememberOptions({ path: "/", maxAge: 100 }, false)).toEqual({ path: "/" });
    expect(rememberOptions({ path: "/", maxAge: 0 }, false)).toEqual({ path: "/", maxAge: 0 });
    expect(rememberOptions({ path: "/", maxAge: 100 }, true)).toEqual({ path: "/", maxAge: 100 });
  });
});

describe("reset-link marker", () => {
  it("is bound to the user, signed and expires", () => {
    const now = 1_000_000;
    const v = signRecovery("user-1", 60_000, now);
    expect(verifyRecovery(v, "user-1", now + 1000)).toBe(true);
    expect(verifyRecovery(v, "user-2", now + 1000)).toBe(false);
    expect(verifyRecovery(v, "user-1", now + 61_000)).toBe(false);
    expect(verifyRecovery(v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "user-1", now)).toBe(false);
    expect(verifyRecovery("user-1", "user-1", now)).toBe(false);
  });
});
