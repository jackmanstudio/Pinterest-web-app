import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { SupabaseLedger, type UsageLedger } from "@/lib/usage/ledger";
import { CookieLedger } from "@/lib/usage/cookieLedger";
import type { WorkspaceKind } from "@/lib/types";

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

export async function workspaceIdFor(ctx: RequestContext, kind: WorkspaceKind): Promise<string | null> {
  if (ctx.mode === "demo") return `demo-${kind}`;
  const { data, error } = await ctx.db.from("workspaces").select("id").eq("kind", kind).single();
  if (error || !data) throw new HttpError(404, "Workspace not found");
  return data.id as string;
}
