import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { crossSite, notConfigured, readJson, siteOrigin } from "@/lib/auth/server";
import { EmailSchema, NameSchema, fieldErrors, friendlyAuthError } from "@/lib/auth/validation";
import { isMissingTable } from "@/lib/supabase/compat";
import { rateLimited } from "@/lib/server/rateLimit";
import { getServerSupabase } from "@/lib/supabase/server";

const PREFS = ["notify_publish_failures", "notify_weekly_summary", "notify_product_updates"] as const;
const NEEDS = "Account settings need a database update. Run supabase/migrations/0010_profiles.sql in the Supabase SQL editor.";

async function load() {
  const supabase = await getServerSupabase();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { supabase, user: null, profile: null };
  const p = await supabase.from("profiles").select("full_name, terms_accepted_at, notify_publish_failures, notify_weekly_summary, notify_product_updates, onboarded_at").eq("id", u.user.id).maybeSingle();
  return { supabase, user: u.user, profile: p.error ? null : p.data, missing: isMissingTable(p.error) };
}

/** The signed-in user's own account details. Never returns tokens. */
export async function GET() {
  await connection();
  const nc = notConfigured();
  if (nc) return nc;
  const { user, profile, missing } = await load();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({
    email: user.email,
    pending_email: user.new_email ?? null,
    email_confirmed: Boolean(user.email_confirmed_at),
    providers: user.app_metadata?.providers ?? [user.app_metadata?.provider].filter(Boolean),
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    full_name: profile?.full_name ?? (user.user_metadata?.full_name as string) ?? "",
    prefs: Object.fromEntries(PREFS.map((k) => [k, profile?.[k] ?? k === "notify_publish_failures"])),
    onboarded_at: profile?.onboarded_at ?? null,
    needs_migration: Boolean(missing),
  });
}

const Patch = z.object({
  full_name: NameSchema.optional(),
  email: EmailSchema.optional(),
  prefs: z.object(Object.fromEntries(PREFS.map((k) => [k, z.boolean().optional()])) as Record<(typeof PREFS)[number], z.ZodOptional<z.ZodBoolean>>).optional(),
  onboarded: z.literal(true).optional(),
});

export async function PATCH(request: Request) {
  const blocked = crossSite(request) ?? notConfigured() ?? rateLimited(request, "account");
  if (blocked) return blocked;
  const parsed = Patch.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  const { supabase, user, missing } = await load();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const b = parsed.data;

  const row: Record<string, unknown> = { ...(b.prefs ?? {}) };
  if (b.full_name !== undefined) row.full_name = b.full_name;
  if (b.onboarded) row.onboarded_at = new Date().toISOString();
  if (Object.keys(row).length) {
    if (missing) return NextResponse.json({ error: NEEDS }, { status: 409 });
    const up = await supabase.from("profiles").update(row).eq("id", user.id);
    if (up.error) return NextResponse.json({ error: isMissingTable(up.error) ? NEEDS : "Could not save your settings." }, { status: 500 });
  }
  let emailSent = false;
  if (b.full_name !== undefined || (b.email && b.email !== user.email)) {
    const { error } = await supabase.auth.updateUser(
      { ...(b.full_name !== undefined ? { data: { full_name: b.full_name } } : {}), ...(b.email && b.email !== user.email ? { email: b.email } : {}) },
      { emailRedirectTo: `${siteOrigin(request)}/auth/callback?next=/account` },
    );
    if (error) return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: 400 });
    emailSent = Boolean(b.email && b.email !== user.email);
  }
  return NextResponse.json({ ok: true, emailSent });
}
