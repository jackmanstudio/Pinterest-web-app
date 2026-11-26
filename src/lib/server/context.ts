import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { SupabaseLedger, type UsageLedger } from "@/lib/usage/ledger";
import { CookieLedger } from "@/lib/usage/cookieLedger";
import { isMissingColumn } from "@/lib/supabase/compat";
import { isWorkspaceNiche, nicheFromSlug, type WorkspaceKind, type WorkspaceNiche } from "@/lib/types";

export type RequestContext =
  | { mode: "supabase"; db: SupabaseClient; user: User; ledger: UsageLedger }
  | { mode: "demo"; ledger: UsageLedger };

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Resolves auth and storage mode for an API request. */
export async function getRequestContext(): Promise<RequestContext> {
  if (!isSupabaseConfigured) return { mode: "demo", ledger: new CookieLedger() };
  const db = await getServerSupabase();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new HttpError(401, "Sign in required");
  return { mode: "supabase", db, user: data.user, ledger: new SupabaseLedger(db) };
}

/** The signed-in user's account with this slug: its id and niche template. */
export async function workspaceFor(ctx: RequestContext, kind: WorkspaceKind): Promise<{ id: string; niche: WorkspaceNiche }> {
  if (ctx.mode === "demo") return { id: `demo-${kind}`, niche: nicheFromSlug(kind) };
  let res = await ctx.db.from("workspaces").select("id, kind").eq("slug", kind).maybeSingle();
  // Database without migration 0013: only the two starter accounts exist.
  if (isMissingColumn(res.error)) res = await ctx.db.from("workspaces").select("id, kind").eq("kind", kind).maybeSingle();
  if (res.error || !res.data) throw new HttpError(404, "Workspace not found");
  const niche = res.data.kind as string;
  return { id: res.data.id as string, niche: isWorkspaceNiche(niche) ? niche : "macro" };
}

export async function workspaceIdFor(ctx: RequestContext, kind: WorkspaceKind): Promise<string | null> {
  return (await workspaceFor(ctx, kind)).id;
}
