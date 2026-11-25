import "server-only";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import type { WorkspaceKind } from "@/lib/types";
import { PinterestApi } from "./api";
import { checkPinterestConfig, getPinterestConfig } from "./config";
import { ConnectionRepo } from "./connections";

/** Verifies config + signed-in owner, then returns server-side Pinterest helpers for one workspace. */
export async function pinterestContext(kind: WorkspaceKind) {
  const check = checkPinterestConfig();
  if (!check.ready) throw new HttpError(503, `Pinterest isn't configured on the server. Missing: ${check.missing.join(", ")}`);
  const ctx = await getRequestContext();
  if (ctx.mode !== "supabase") throw new HttpError(503, "Pinterest needs Supabase so tokens can be stored securely on the server.");
  // Ownership check through the user's own session (RLS) before using the service role.
  const workspaceId = (await workspaceIdFor(ctx, kind))!;
  const cfg = getPinterestConfig();
  return { ctx, cfg, workspaceId, api: new PinterestApi(cfg), repo: new ConnectionRepo(getAdminSupabase(), cfg.encryptionKey) };
}
