import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/pinterest/config";
import { pinterestContext } from "@/lib/pinterest/server";
import { createState, STATE_COOKIE, STATE_TTL_SEC } from "@/lib/pinterest/state";
import { HttpError } from "@/lib/server/context";
import { isWorkspaceKind } from "@/lib/types";

/** Starts Pinterest OAuth for one workspace. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  try {
    const { ctx, cfg } = await pinterestContext(kind);
    if (ctx.mode !== "supabase") throw new HttpError(503, "Supabase required");
    const { state, cookie } = createState(kind, ctx.user.id, cfg.encryptionKey);
    const res = NextResponse.redirect(buildAuthorizeUrl(cfg, state));
    res.cookies.set(STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: STATE_TTL_SEC,
      path: "/api/pinterest",
    });
    return res;
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : "Could not start Pinterest connection";
    return NextResponse.redirect(new URL(`/w/${kind}/pinterest?error=${encodeURIComponent(msg)}`, url.origin));
  }
}
