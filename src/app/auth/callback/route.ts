import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE, signRecovery } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/validation";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Landing for email links (verify email, reset password, change email) and
 * Google sign-in: exchanges the one-time code for a session (PKCE).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const errorDesc = url.searchParams.get("error_description");
  if (errorDesc) return NextResponse.redirect(new URL(`/login?error=link`, url.origin));
  if (!code) return NextResponse.redirect(new URL("/login", url.origin));

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL(next === "/reset-password" ? "/forgot-password?error=expired" : "/login?error=link", url.origin));
  if (next === "/reset-password") {
    // Lets /api/auth/password skip the current-password check, for 15 minutes, for this user only.
    (await cookies()).set(RECOVERY_COOKIE, signRecovery(data.user.id), { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: 15 * 60 });
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
