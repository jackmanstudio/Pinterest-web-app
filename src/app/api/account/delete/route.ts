import { NextResponse } from "next/server";
import { z } from "zod";
import { IMAGE_BUCKET } from "@/lib/ai/image/types";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { log } from "@/lib/server/log";
import { rateLimited } from "@/lib/server/rateLimit";
import { getAdminSupabase } from "@/lib/supabase/admin";

const Body = z.object({ confirm: z.literal("DELETE MY ACCOUNT") });

/**
 * Permanently deletes the user's account and all their data in this app
 * (workspaces cascade to drafts, tokens, jobs, analytics; images removed from storage).
 * Pins already published on Pinterest are NOT touched.
 */
export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "account");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Type "DELETE MY ACCOUNT" to confirm.' }, { status: 400 });
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(400, "In Demo mode, clear the browser data instead.");
    const admin = getAdminSupabase();
    const { data: ws } = await ctx.db.from("workspaces").select("id");
    for (const { id } of ws ?? []) {
      const { data: files } = await admin.storage.from(IMAGE_BUCKET).list(id, { limit: 1000 });
      if (files?.length) await admin.storage.from(IMAGE_BUCKET).remove(files.map((f) => `${id}/${f.name}`));
    }
    const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
    if (error) throw new Error(error.message);
    log("info", "account_deleted", { user: ctx.user.id });
    await ctx.db.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
