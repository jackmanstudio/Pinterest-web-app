import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findBoardByName, type Board } from "@/lib/boards/automation";
import { pinterestContext } from "@/lib/pinterest/server";
import { describePinterestError, ReconnectRequired } from "@/lib/pinterest/sync";
import { PinterestApiError, type PinterestBoard } from "@/lib/pinterest/api";
import { HttpError } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { reportError } from "@/lib/server/errors";

const Body = z.object({
  workspace: WorkspaceSlug,
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500).default(""),
  privacy: z.enum(["PUBLIC", "SECRET"]).default("PUBLIC"),
  /** The user's explicit approval, typed or clicked in the UI. Boards are never created automatically. */
  confirm: z.literal(true),
});

/**
 * Creates ONE board on the connected Pinterest account, after the user approved
 * the suggestion. Refuses if a board with the same name already exists, checked
 * against a fresh list from Pinterest (not only the last sync).
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "pinterest");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Board creation needs a name and your confirmation." }, { status: 400 });
  const { workspace, name, description, privacy } = parsed.data;

  let pc: Awaited<ReturnType<typeof pinterestContext>>;
  try {
    pc = await pinterestContext(workspace);
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
  const { api, repo, workspaceId, ctx } = pc;
  const conn = await repo.get(workspaceId);
  if (!conn) return NextResponse.json({ error: "Connect Pinterest to this workspace first." }, { status: 409 });
  if (!conn.scopes.includes("boards:write")) {
    return NextResponse.json({ error: "Pinterest didn't grant board permission (boards:write). Turn on publishing on the server and reconnect Pinterest." }, { status: 403 });
  }

  try {
    const token = await repo.accessToken(api, conn);
    const live = await api.paginate<PinterestBoard>(token, "/boards", 10, 250);
    const existing: Board[] = live.items.map((b) => ({ board_id: b.id, name: b.name }));
    const dup = findBoardByName(existing, name);
    if (dup) return NextResponse.json({ error: `A board named “${dup.name}” already exists, so no duplicate was made.`, existing: dup }, { status: 409 });

    const board = await api.createBoard(token, { name, description: description || undefined, privacy });
    const admin = getAdminSupabase();
    const row = { workspace_id: workspaceId, board_id: board.id, name: board.name, description: board.description ?? null, privacy: board.privacy ?? privacy, pin_count: 0, synced_at: new Date().toISOString(), created_in_app: true };
    let up = await admin.from("pinterest_boards").upsert(row, { onConflict: "workspace_id,board_id" });
    if (up.error && /created_in_app/.test(up.error.message)) {
      const { created_in_app: _skip, ...legacy } = row;
      void _skip;
      up = await admin.from("pinterest_boards").upsert(legacy, { onConflict: "workspace_id,board_id" });
    }
    if (up.error) await reportError(new Error(`Board saved on Pinterest but not locally: ${up.error.message}`), { route: "/api/pinterest/boards", method: "POST", status: 200, context: { code: up.error.code } });
    const audit = await admin.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_id: ctx.mode === "supabase" ? ctx.user.id : null,
      action: "board_created",
      target_type: "pinterest_board",
      target_id: board.id,
      details: { name: board.name, privacy: row.privacy },
    });
    if (audit.error) await reportError(new Error(`Audit insert failed: ${audit.error.message}`), { route: "/api/pinterest/boards", method: "POST", status: 200 });
    return NextResponse.json({ board: { board_id: board.id, name: board.name, description: row.description, privacy: row.privacy } });
  } catch (err) {
    const msg = describePinterestError(err);
    if (err instanceof ReconnectRequired || (err instanceof PinterestApiError && err.isAuth)) await repo.markNeedsReconnect(workspaceId, msg);
    const status = err instanceof PinterestApiError ? (err.isRateLimited ? 429 : err.status === 409 ? 409 : 502) : err instanceof ReconnectRequired ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
