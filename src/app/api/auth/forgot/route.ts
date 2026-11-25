import { NextResponse } from "next/server";
import { crossSite, emailKey, notConfigured, readJson, siteOrigin } from "@/lib/auth/server";
import { ForgotSchema, fieldErrors } from "@/lib/auth/validation";
import { log } from "@/lib/server/log";
import { clientIp, rateLimitedKey } from "@/lib/server/rateLimit";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Sends a password reset link (single-use, expires per the Supabase Auth
 * setting, 1 hour by default). Always answers the same way so it can't be
 * used to find out which emails have accounts.
 */
export async function POST(request: Request) {
  const blocked = crossSite(request) ?? notConfigured() ?? rateLimitedKey("authEmail", clientIp(request));
  if (blocked) return blocked;
  const parsed = ForgotSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address.", fields: fieldErrors(parsed.error) }, { status: 400 });
  const perEmail = rateLimitedKey("authEmail", emailKey(parsed.data.email));
  if (perEmail) return perEmail;
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteOrigin(request)}/auth/callback?next=/reset-password` });
  if (error) log("warn", "reset_email_failed", { reason: error.code ?? "auth" });
  return NextResponse.json({ ok: true });
}
