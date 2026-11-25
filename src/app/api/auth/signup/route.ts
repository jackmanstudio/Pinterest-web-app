import { NextResponse } from "next/server";
import { crossSite, notConfigured, readJson, siteOrigin } from "@/lib/auth/server";
import { SignupSchema, fieldErrors, friendlyAuthError } from "@/lib/auth/validation";
import { log } from "@/lib/server/log";
import { clientIp, rateLimitedKey } from "@/lib/server/rateLimit";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Creates an account through Supabase Auth (passwords are hashed by Supabase;
 * this app never stores them). The answer is the same whether or not the
 * email is already registered, so nobody can probe for accounts.
 */
export async function POST(request: Request) {
  const blocked = crossSite(request) ?? notConfigured() ?? rateLimitedKey("authSignup", clientIp(request));
  if (blocked) return blocked;
  const parsed = SignupSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  const { email, password, fullName } = parsed.data;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, terms_accepted: "true" },
      emailRedirectTo: `${siteOrigin(request)}/auth/callback?next=/welcome`,
    },
  });
  if (error) {
    log("warn", "signup_failed", { reason: error.code ?? "auth" });
    if (/already|registered|exists/i.test(error.message)) return NextResponse.json({ ok: true, verify: true });
    return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: error.status === 429 ? 429 : 400 });
  }
  // With email confirmation on, there is no session until the link is clicked.
  return NextResponse.json({ ok: true, verify: !data.session });
}
