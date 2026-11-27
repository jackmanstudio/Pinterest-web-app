import { connection, NextResponse } from "next/server";
import { checkPinterestConfig } from "@/lib/pinterest/config";
import { pinterestContext } from "@/lib/pinterest/server";
import { HttpError } from "@/lib/server/context";
import { isWorkspaceKind } from "@/lib/types";
import { errorResponse } from "@/lib/server/errors";

/** Safe connection info + synced boards/pins for one workspace. Never returns tokens. */
export async function GET(request: Request) {
  await connection();
  const kind = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  const config = checkPinterestConfig();
  if (!config.ready) return NextResponse.json({ config, connection: null, boards: [], pins: [] });
  try {
    const { ctx, repo, workspaceId } = await pinterestContext(kind);
    if (ctx.mode !== "supabase") throw new HttpError(503, "Supabase required");
    const [info, boards, pins] = await Promise.all([
      repo.info(workspaceId),
      ctx.db.from("pinterest_boards").select("board_id, name, description, privacy, pin_count, synced_at").eq("workspace_id", workspaceId).order("name"),
      ctx.db
        .from("pinterest_pins")
        .select("pin_id, board_id, title, description, link, alt_text, image_url, pin_created_at", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order("pin_created_at", { ascending: false })
        .limit(60),
    ]);
    return NextResponse.json({
      config,
      connection: info,
      boards: boards.data ?? [],
      pins: pins.data ?? [],
      pin_total: pins.count ?? 0,
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err, request, "Could not load the Pinterest status.");
  }
}
