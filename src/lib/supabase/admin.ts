import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * Service-role client. Bypasses RLS, so callers MUST first verify the user owns
 * the workspace (via the user's own session) and filter every query by it.
 */
export function getAdminSupabase(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** True when the service-role key is set, so server-only workflow steps can run. */
export function hasAdminSupabase(): boolean {
  return Boolean(SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Shown when a step needs the service-role key and it isn't set on the server. */
export const ADMIN_KEY_MISSING_MESSAGE =
  "This step needs a server setting that isn't added yet (SUPABASE_SERVICE_ROLE_KEY in Vercel). Ask the site owner to add it.";
