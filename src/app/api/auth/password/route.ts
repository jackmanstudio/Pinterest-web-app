import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE, crossSite, verifyRecovery, notConfigured, readJson } from "@/lib/auth/server";
import { NewPasswordSchema, fieldErrors, friendlyAuthError, passwordProblems } from "@/lib/auth/validation";
import { log } from "@/lib/server/log";
import { clientIp, rateLimitedKey } from "@/lib/server/rateLimit";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Sets a new password for the signed-in user. From a reset link (short-lived
 * recovery cookie set by /auth/callback) no current password is needed;
 * otherwise the current password must be confirmed first.
 */
export async function POST(request: Request) {
  const blocked = crossSite(request) ?? notConfigured() ?? rateLimitedKey("authPassword", clientIp(request));
  if (blocked) return blocked;
  const parsed = NewPasswordSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Your reset link has expired. Request a new one." }, { status: 401 });
  const user = u.user;

  const problems = passwordProblems(parsed.data.password, { email: user.email, name: (user.user_metadata?.full_name as string) ?? "" });
  if (problems.length) return NextResponse.json({ error: "Choose a stronger password.", fields: { password: `Password needs: ${problems.join(", ").toLowerCase()}.` } }, { status: 400 });

  const jar = await cookies();
  const recovering = verifyRecovery(jar.get(RECOVERY_COOKIE)?.value, user.id);
  if (!recovering) {
    if (!parsed.data.currentPassword) return NextResponse.json({ error: "Enter your current password.", fields: { currentPassword: "Enter your current password." } }, { status: 400 });
    const check = await supabase.auth.signInWithPassword({ email: user.email!, password: parsed.data.currentPassword });
    if (check.error) return NextResponse.json({ error: "Your current password is incorrect.", fields: { currentPassword: "Incorrect password." } }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: 400 });
  jar.delete(RECOVERY_COOKIE);
  // Sign out every other device after a password change.
  await supabase.auth.signOut({ scope: "others" }).catch(() => {});
  log("info", "password_changed", { via: recovering ? "reset" : "settings" });
  return NextResponse.json({ ok: true });
}
