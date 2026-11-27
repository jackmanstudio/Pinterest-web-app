import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pinterestContext } from "@/lib/pinterest/server";
import { STATE_COOKIE, verifyState } from "@/lib/pinterest/state";
import { describePinterestError } from "@/lib/pinterest/sync";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { isWorkspaceKind } from "@/lib/types";
import { reportError } from "@/lib/server/errors";

/** Pinterest redirects here with ?code&state (or ?error). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  // Without a known account, land on the accounts list (any account may have been deleted).
  const back = (kind: string | null, q: string) => {
    const res = NextResponse.redirect(new URL(kind && isWorkspaceKind(kind) ? `/w/${kind}/pinterest?${q}` : `/overview?${q}`, url.origin));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/pinterest", maxAge: 0 });
    return res;
  };

  let kind: string | null = null;
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(503, "Supabase required");
    const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "";
    const st = verifyState(raw, url.searchParams.get("state"), ctx.user.id, secret);
    if (!st || !isWorkspaceKind(st.workspace)) return back(null, "error=" + encodeURIComponent("Connection expired or invalid. Please try again."));

    kind = st.workspace;
    if (url.searchParams.get("error")) {
      return back(st.workspace, "error=" + encodeURIComponent("Pinterest access was not granted."));
    }
    const code = url.searchParams.get("code");
    if (!code) return back(st.workspace, "error=" + encodeURIComponent("Pinterest did not return an authorization code."));

    const { api, repo, cfg, workspaceId } = await pinterestContext(st.workspace);
    const tokens = await api.exchangeCode(code);
    const account = await api.account(tokens.access_token);
    await repo.save(workspaceId, cfg.env, tokens, account, cfg.scopes);
    return back(st.workspace, "connected=1");
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : describePinterestError(err);
    if (!(err instanceof HttpError)) await reportError(err, { source: "api", route: "/api/pinterest/callback", method: "GET", status: 302 });
    return back(kind, "error=" + encodeURIComponent(msg));
  }
}
