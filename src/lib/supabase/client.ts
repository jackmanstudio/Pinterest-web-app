"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import { REMEMBER_COOKIE, readRemember, rememberOptions } from "./remember";

let client: SupabaseClient | null = null;

function readCookies(): { name: string; value: string }[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split("; ").map((c) => {
    const i = c.indexOf("=");
    return { name: decodeURIComponent(c.slice(0, i)), value: decodeURIComponent(c.slice(i + 1)) };
  });
}

interface CookieOpts {
  path?: string;
  maxAge?: number;
  domain?: string;
  sameSite?: string | boolean;
  secure?: boolean;
}
function writeCookie(name: string, value: string, o: CookieOpts = {}) {
  let s = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}`;
  if (typeof o.maxAge === "number") s += `; Max-Age=${o.maxAge}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  s += `; SameSite=${typeof o.sameSite === "string" ? o.sameSite : "Lax"}`;
  if (o.secure || location.protocol === "https:") s += "; Secure";
  document.cookie = s;
}

export function getBrowserSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => readCookies(),
      setAll: (toSet) => {
        const remember = readRemember((n) => readCookies().find((c) => c.name === n)?.value);
        for (const { name, value, options } of toSet) writeCookie(name, value, rememberOptions(options as CookieOpts, remember));
      },
    },
  });
  return client;
}

/** Clears the "remember me" choice (on sign-out). */
export function clearRememberCookie() {
  if (typeof document !== "undefined") writeCookie(REMEMBER_COOKIE, "", { maxAge: 0 });
}
