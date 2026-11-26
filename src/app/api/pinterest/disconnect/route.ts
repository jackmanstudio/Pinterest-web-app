import { NextResponse } from "next/server";
import { z } from "zod";
import { pinterestContext } from "@/lib/pinterest/server";
import { HttpError } from "@/lib/server/context";
import { WorkspaceSlug } from "@/lib/workspaces/schema";

const Body = z.object({ workspace: WorkspaceSlug });

/** Removes the stored tokens and synced copies for this workspace. Nothing on Pinterest is touched. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { repo, workspaceId } = await pinterestContext(parsed.data.workspace);
    await repo.disconnect(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
