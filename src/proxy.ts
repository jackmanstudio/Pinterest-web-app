import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";
import { readRemember, rememberOptions } from "@/lib/supabase/remember";
import { DEMO_COOKIE } from "@/lib/auth/demo";

const OLD_HOST = "pinterest-web-app.vercel.app";
const NEW_ORIGIN = "https://pin-ai-studio.vercel.app";

/** Pages and routes that work without an account. Everything else needs sign-in. */
const PUBLIC = [/^\/robots\.txt$/, /^\/login/, /^\/signup/, /^\/forgot-password/, /^\/reset-password/, /^\/terms/, /^\/privacy/, /^\/auth\//, /^\/api\/auth\/(login|signup|forgot)$/, /^\/api\/cron\//];

/** Refreshes the Supabase session and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  // The old "pinterest-…" address got flagged as phishing; send page visits to the new address.
  const host = request.headers.get("host") ?? "";
  if (host === OLD_HOST && !request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.redirect(`${NEW_ORIGIN}${request.nextUrl.pathname}${request.nextUrl.search}`, 308);
  }
  if (!isSupabaseConfigured) return demoGate(request);
  // No Supabase auth cookie means nobody is signed in: skip the network call to Supabase entirely.
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  if (!hasSession) return signedOut(request);

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
    return toLogin(request);
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

/** A visitor without any session: public pages pass, the home page shows sign-in in place, the rest go to /login. */
function signedOut(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return toLogin(request);
}

/**
 * Sends a signed-out visitor to sign in. The home page shows the sign-in page in place (no redirect hop,
 * which costs a full round trip on phones); other pages redirect to /login?next=… so they come back after.
 */
function toLogin(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (path === "/") return NextResponse.rewrite(url);
  url.searchParams.set("next", path + request.nextUrl.search);
  return NextResponse.redirect(url);
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
    return toLogin(request);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|otf|woff|woff2|txt)$).*)"],
};
