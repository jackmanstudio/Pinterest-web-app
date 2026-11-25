import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** Email confirmation / magic-link landing: exchanges the code for a session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
  }
  return NextResponse.redirect(new URL("/w/fashion", url.origin));
}
