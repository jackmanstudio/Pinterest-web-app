import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { checkUrl } from "@/lib/tools/urlCheck";

const Body = z.object({ url: z.string().trim().min(1).max(2000), title: z.string().max(200).optional() });

/** Destination URL checker (spec 24.5). Signed-in users only; public addresses only. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  try {
    await getRequestContext();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send a url to check" }, { status: 400 });
    return NextResponse.json(await checkUrl(parsed.data.url, parsed.data.title ?? ""));
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("url check failed", err);
    return NextResponse.json({ error: "Could not check the link" }, { status: 500 });
  }
}
