/**
 * Demo sign-in, used only while Supabase isn't connected. It keeps a name and
 * email in this browser so the app has a signed-in feel; it is not an account
 * and no password is stored or checked. Real accounts start once Supabase is set.
 */
export const DEMO_COOKIE = "pas_demo";
const KEY = "pas-demo-user";

export interface DemoUser { name: string; email: string; signedInAt: string }

export function demoSignIn(u: { name?: string; email: string }): DemoUser {
  const fromEmail = (u.email.split("@")[0] ?? "").replace(/[._-]+/g, " ").trim();
  const guess = fromEmail ? fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1) : "";
  const user: DemoUser = { name: (u.name ?? "").trim() || guess || "Demo user", email: u.email.trim().toLowerCase(), signedInAt: new Date().toISOString() };
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
