/**
 * Demo sign-in, used only while Supabase isn't connected. It keeps a name and
 * email in this browser so the app has a signed-in feel; it is not an account
 * and no password is stored or checked. Real accounts start once Supabase is set.
 */
export const DEMO_COOKIE = "pas_demo";
const KEY = "pas-demo-user";

export interface DemoUser {
  name: string;
  email: string;
  signedInAt: string;
  /** True when the person typed this name themselves (not guessed from the email). */
  nameSet?: boolean;
}

export function demoSignIn(u: { name?: string; email: string }): DemoUser {
  const fromEmail = (u.email.split("@")[0] ?? "").replace(/[._-]+/g, " ").trim();
  const guess = fromEmail ? fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1) : "";
  const typed = (u.name ?? "").trim();
  const user: DemoUser = { name: typed || guess || "Demo user", email: u.email.trim().toLowerCase(), signedInAt: new Date().toISOString(), nameSet: Boolean(typed) };
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* private mode: the cookie still lets them in */
  }
  document.cookie = `${DEMO_COOKIE}=1; path=/; max-age=${30 * 86400}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  return user;
}

export function demoSignOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function getDemoUser(): DemoUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DemoUser) : null;
  } catch {
    return null;
  }
}

/** The name to greet the person with: only one they chose, never a guess from their email. */
export function demoDisplayName(u: DemoUser | null): string {
  return u?.nameSet ? u.name : "";
}

/** Saves the name the person wants to be called in this browser. */
export function setDemoName(name: string): DemoUser | null {
  const u = getDemoUser();
  if (!u) return null;
  const clean = name.trim().slice(0, 60);
  const next: DemoUser = { ...u, name: clean || u.name, nameSet: Boolean(clean) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
