import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";
import { readRemember, rememberOptions } from "@/lib/supabase/remember";
import { DEMO_COOKIE } from "@/lib/auth/demo";

/** Pages and routes that work without an account. Everything else needs sign-in. */
const PUBLIC = [/^\/login/, /^\/signup/, /^\/forgot-password/, /^\/reset-password/, /^\/terms/, /^\/privacy/, /^\/auth\//, /^\/api\/auth\/(login|signup|forgot)$/, /^\/api\/cron\//];

/** Refreshes the Supabase session and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return demoGate(request);

  let response = NextResponse.next({ request });
  const remember = readRemember((n) => request.cookies.get(n)?.value);
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, rememberOptions(options, remember));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // /api/cron authenticates with CRON_SECRET instead of a user session.
  const isPublic = PUBLIC.some((r) => r.test(path));
  if (!data.user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Come back to the page they asked for after signing in.
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Signed-in users don't need the sign-in pages.
  if (data.user && /^\/(login|signup|forgot-password)/.test(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

/**
 * Demo mode (no Supabase): a browser-only sign-in cookie decides who sees the app.
 * It is not real security, only the same sign-in flow people will get later.
 * APIs stay open so demo tools keep working.
 */
function demoGate(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const signedIn = request.cookies.get(DEMO_COOKIE)?.value === "1";
  const isPublic = PUBLIC.some((r) => r.test(path)) || path.startsWith("/api/");
  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (signedIn && /^\/(login|signup|forgot-password)/.test(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
