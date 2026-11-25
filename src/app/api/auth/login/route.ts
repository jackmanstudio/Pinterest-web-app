import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { crossSite, emailKey, notConfigured, readJson } from "@/lib/auth/server";
import { LoginSchema, fieldErrors, friendlyAuthError } from "@/lib/auth/validation";
import { log } from "@/lib/server/log";
import { clientIp, rateLimitedKey } from "@/lib/server/rateLimit";
import { getServerSupabase } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/supabase/remember";

/** Email + password sign-in, validated and rate-limited on the server. Session cookies are set by Supabase SSR. */
export async function POST(request: Request) {
  const blocked = crossSite(request) ?? notConfigured() ?? rateLimitedKey("authLogin", clientIp(request));
  if (blocked) return blocked;
  const parsed = LoginSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  const { email, password, remember } = parsed.data;
  const perEmail = rateLimitedKey("authLoginEmail", emailKey(email));
  if (perEmail) return perEmail;

  // Save the choice first so the session cookies below follow it.
  const jar = await cookies();
  jar.set(REMEMBER_COOKIE, remember ? "1" : "0", { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(remember ? { maxAge: 400 * 86400 } : {}) });
  const supabase = await getServerSupabase({ remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    log("warn", "login_failed", { reason: error.code ?? "auth" });
    return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: error.status === 429 ? 429 : 401 });
  }
  return NextResponse.json({ ok: true });
}
