import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE, crossSite, notConfigured } from "@/lib/auth/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/supabase/remember";

/** Ends the session on this device and clears the session cookies. */
export async function POST(request: Request) {
  const blocked = crossSite(request) ?? notConfigured();
  if (blocked) return blocked;
  const supabase = await getServerSupabase();
  await supabase.auth.signOut({ scope: "local" });
  const jar = await cookies();
  jar.delete(REMEMBER_COOKIE);
  jar.delete(RECOVERY_COOKIE);
  return NextResponse.json({ ok: true });
}
