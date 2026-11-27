import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import type { PhotoPinText } from "@/lib/ai/text/prompt";
import { BrandSchema } from "@/lib/drafts/validation";
import { PHOTO_LIMITS, photoTopic } from "@/lib/photos/validate";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { errorResponse } from "@/lib/server/errors";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import type { UsageEntry } from "@/lib/usage/ledger";
import { estimateTextCost } from "@/lib/usage/pricing";
import { WorkspaceSlug } from "@/lib/workspaces/schema";

export const maxDuration = 120;


const Body = z.object({
  workspace: WorkspaceSlug,
  brand: BrandSchema,
  topic: z.string().trim().max(200).default(""),
  language: z.string().max(40).optional(),
  photos: z
    .array(
      z.object({
        topic: z.string().trim().max(200).default(""),
        /** Small JPEG copy (base64, no data: prefix) so the AI can read the photo. */
        jpeg: z.string().max(1_500_000).regex(/^[A-Za-z0-9+/=]+$/),
      }),
    )
    .min(1)
    .max(PHOTO_LIMITS.batch),
});

/** Writes one pin's copy per photo (title, description, tags, alt text). Saves nothing; the browser saves the drafts. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "generate");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const b = parsed.data;

  let usageBase: Omit<UsageEntry, "input_tokens" | "output_tokens" | "est_cost_usd" | "status" | "error"> | null = null;
  let ledger: Awaited<ReturnType<typeof getRequestContext>>["ledger"] | null = null;
  try {
    const ctx = await getRequestContext();
    ledger = ctx.ledger;
    const workspaceId = await workspaceIdFor(ctx, b.workspace);
    const provider = getTextProvider();
    usageBase = { workspace_id: workspaceId, workspace_kind: b.workspace, kind: "text", provider: provider.name, model: null, source: provider.source, images: 0 };
    await assertWithinBudget(ctx.ledger, provider.source === "ai");

    let pins: PhotoPinText[];
    let model: string | null = null;
    let usage = { input_tokens: 0, output_tokens: 0 };
    let basedOn: "photo" | "topic";
    if (provider.describePhotos) {
      const r = await provider.describePhotos(
        { photos: b.photos.map((p) => ({ topic: p.topic })), topic: b.topic, language: b.language, brand: b.brand },
        b.photos.map((p) => ({ base64: p.jpeg, mediaType: "image/jpeg" as const })),
      );
      ({ pins, model, usage } = r);
      basedOn = "photo";
    } else {
      // This text model can't see images: write from each photo's own topic (or the shared one), and say so in the UI.
      const topics = b.photos.map((p) => photoTopic(p.topic, b.topic));
      if (topics.some((t) => !t)) throw new HttpError(422, "This AI can't look at photos. Type a topic (for example “winter outfits”) so it can write the pins.");
      const byTopic = new Map<string, number[]>();
      topics.forEach((t, i) => byTopic.set(t!, [...(byTopic.get(t!) ?? []), i]));
      pins = new Array(b.photos.length);
      // One request per distinct topic, side by side (a batch has at most 5 photos).
      const results = await Promise.all([...byTopic].map(async ([idea, idx]) => ({ idx, r: await provider.generateDrafts({ workspace: b.workspace, idea, brand: b.brand, language: b.language }) })));
      for (const { idx, r } of results) {
        model = r.model;
        usage = { input_tokens: usage.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: usage.output_tokens + (r.usage?.output_tokens ?? 0) };
        idx.forEach((photoIndex, j) => {
          const d = r.drafts[j % r.drafts.length];
          const p = b.photos[photoIndex];
          pins[photoIndex] = { title: d.title, description: d.description, tags: d.tags, alt_text: p.topic || b.topic || d.alt_text };
        });
      }
      basedOn = "topic";
    }

    const cost = estimateTextCost(model, usage.input_tokens, usage.output_tokens);
    await ctx.ledger.record({ ...usageBase, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, est_cost_usd: cost, status: "ok", error: null });
    return NextResponse.json({ pins, source: provider.source, provider: provider.name, model, basedOn });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, retryable: false }, { status: 402 });
    if (ledger && usageBase) await ledger.record({ ...usageBase, input_tokens: 0, output_tokens: 0, est_cost_usd: 0, status: "error", error: (err as Error).message }).catch(() => {});
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: err.status });
    return errorResponse(err, request, "Writing the pin text failed. Please retry.");
  }
}
