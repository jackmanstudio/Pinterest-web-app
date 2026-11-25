import { NextResponse } from "next/server";
import { checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { cronAuthorized } from "@/lib/server/cron";
import { log } from "@/lib/server/log";
import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * Re-encrypts all stored Pinterest tokens with the current TOKEN_ENCRYPTION_KEY
 * (see src/lib/crypto/tokens.ts for the rotation steps). Needs CRON_SECRET.
 * Never returns or logs tokens.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkPinterestConfig().ready) return NextResponse.json({ error: "Pinterest not configured" }, { status: 503 });
  const cfg = getPinterestConfig();
  const result = await new ConnectionRepo(getAdminSupabase(), cfg.encryptionKey).rotateAll();
  log("info", "token_key_rotation", result);
  return NextResponse.json(result);
}
