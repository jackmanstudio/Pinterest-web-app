import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { readRemember, rememberOptions } from "./remember";

/** Server Supabase client bound to the request cookies. `remember` overrides the saved "remember me" choice (used at sign-in). */
export async function getServerSupabase(opts: { remember?: boolean } = {}) {
  const cookieStore = await cookies();
  const remember = opts.remember ?? readRemember((n) => cookieStore.get(n)?.value);
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, rememberOptions(options, remember));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}
