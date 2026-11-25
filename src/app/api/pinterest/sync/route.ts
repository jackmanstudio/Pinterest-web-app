import { NextResponse } from "next/server";
import { z } from "zod";
import { pinterestContext } from "@/lib/pinterest/server";
import { describePinterestError, ensureAccessToken, fetchBoardsAndPins, ReconnectRequired } from "@/lib/pinterest/sync";
import { PinterestApiError } from "@/lib/pinterest/api";
import { HttpError } from "@/lib/server/context";
import { WORKSPACE_KINDS } from "@/lib/types";

const Body = z.object({ workspace: z.enum(WORKSPACE_KINDS) });

/** Read-only sync of boards and pins. Never creates, edits or deletes anything on Pinterest. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  let pc: Awaited<ReturnType<typeof pinterestContext>>;
  try {
    pc = await pinterestContext(parsed.data.workspace);
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
  const { api, repo, workspaceId } = pc;

  const conn = await repo.get(workspaceId);
  if (!conn) return NextResponse.json({ error: "This workspace isn't connected to Pinterest." }, { status: 409 });
  if (!(await repo.beginSync(workspaceId))) return NextResponse.json({ error: "A sync is already running." }, { status: 409 });

  try {
    const token = await ensureAccessToken(api, conn, (t) => repo.updateTokens(workspaceId, t, conn.refresh_token));
    const result = await fetchBoardsAndPins(api, token);
    await repo.replaceSyncedData(workspaceId, result.boards, result.pins, !result.truncated);
    await repo.finishSync(workspaceId, { ok: true });
    return NextResponse.json({ boards: result.boards.length, pins: result.pins.length, truncated: result.truncated });
  } catch (err) {
    const msg = describePinterestError(err);
    if (err instanceof ReconnectRequired || (err instanceof PinterestApiError && err.isAuth)) await repo.markNeedsReconnect(workspaceId, msg);
    else await repo.finishSync(workspaceId, { ok: false, error: msg });
    const status = err instanceof PinterestApiError ? (err.isRateLimited ? 429 : 502) : err instanceof ReconnectRequired ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
