import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getImageProvider } from "@/lib/ai/image";
import { IMAGE_BUCKET, PIN_IMAGE_SIZE } from "@/lib/ai/image/types";
import { withRetry } from "@/lib/ai/retry";
import { ProviderError } from "@/lib/ai/text/types";
import { getRequestContext, HttpError, workspaceFor } from "@/lib/server/context";
import type { WorkspaceNiche } from "@/lib/types";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { bestPinImage, brandArtFor, brandPinImage, logoFromDataUrl, type BrandArt } from "@/lib/brand/server";
import { readTemplate } from "@/lib/brand/template";
import { buildImagePrompt } from "@/lib/ai/image/prompt";
import { PhotoError, pagePhoto as fetchPagePhoto } from "@/lib/tools/pagePhoto";
import { errorResponse } from "@/lib/server/errors";

const Body = z.object({
  workspace: WorkspaceSlug,
  draftId: z.string().min(1).max(64),
  // Only used in Demo storage mode, where the server can't read the draft or brand.
  prompt: z.string().max(2000).optional(),
  title: z.string().max(200).optional(),
  angle: z.string().max(80).optional(),
  template: z.unknown().optional(),
  imageStyle: z.string().max(120).optional(),
  /** Use this photo (e.g. from the source page) instead of generating one. Fetched with the SSRF guard. */
  sourceImage: z.string().url().max(2048).optional(),
  /** The page the photo came from (sent as referer; some CDNs require it). */
  sourcePage: z.string().url().max(2048).optional(),
});

export async function POST(request: Request) {
  const tStart = Date.now();
  const limitedRes = rateLimited(request, "images");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { workspace, draftId } = parsed.data;

  let ctx: Awaited<ReturnType<typeof getRequestContext>>;
  try {
    ctx = await getRequestContext();
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  const provider = getImageProvider();
  let workspaceId: string | null = null;
  let niche: WorkspaceNiche = "macro";
  let markFailed = async () => {};
  try {
    ({ id: workspaceId, niche } = await workspaceFor(ctx, workspace));
    let prompt = parsed.data.prompt ?? "";
    let title = parsed.data.title ?? "";
    let angle = parsed.data.angle;
    let imageStyle = parsed.data.imageStyle ?? "";
    let art: BrandArt;

    if (ctx.mode === "supabase") {
      // Read the draft through RLS: proves it belongs to this user and workspace.
      const { data: draft, error } = await ctx.db
        .from("pin_drafts")
        .select("id, title, angle, image_prompt, image_status, image_path")
        .eq("workspace_id", workspaceId)
        .eq("id", draftId)
        .single();
      if (error || !draft) throw new HttpError(404, "Draft not found in this workspace");
      if (draft.image_status === "pending") throw new HttpError(409, "An image is already being generated for this draft");
      prompt = draft.image_prompt;
      title = draft.title;
      angle = draft.angle;
      // Independent reads and the "pending" mark run together (one round trip instead of three).
      const [brandArt, { data: b }] = await Promise.all([
        brandArtFor(ctx.db, workspaceId!),
        ctx.db.from("brand_settings").select("image_style").eq("workspace_id", workspaceId).maybeSingle(),
        ctx.db.from("pin_drafts").update({ image_status: "pending" }).eq("id", draftId).eq("workspace_id", workspaceId),
      ]);
      art = brandArt;
      imageStyle = (b?.image_style as string | undefined) ?? "";
      markFailed = async () => {
        await ctx.db.from("pin_drafts").update({ image_status: "failed" }).eq("id", draftId).eq("workspace_id", workspaceId);
      };
    }
    else {
      const template = readTemplate(parsed.data.template);
      art = { template, logo: logoFromDataUrl(template.logo) };
    }
    let source = parsed.data.sourceImage;
    if (!source && !prompt.trim()) throw new HttpError(400, "Add an image prompt first");

    const fullPrompt = buildImagePrompt({ title, scene: prompt, kind: niche, overlay: art.template.style, angle, palette: art.template.palette, imageStyle });
    // A page photo first (retried inside); if the site still refuses it, make an AI image instead of leaving the pin empty.
    let notice: string | null = null;
    let pagePhotoRaw: Awaited<ReturnType<typeof fetchPagePhoto>> | null = null;
    if (source) {
      try {
        pagePhotoRaw = await fetchPagePhoto(source, { referer: parsed.data.sourcePage });
      } catch (e) {
        const why = e instanceof PhotoError ? e.message : "Couldn't download that photo.";
        if (!prompt.trim()) throw new HttpError(422, why);
        notice = `${why} An AI image was made instead.`;
        source = undefined;
      }
    }
    if (!source) await assertWithinBudget(ctx.ledger, provider.source === "ai");
    const tPrep = Date.now();
    // Headline, palette, brand and logo are drawn on the server, then saved as one JPEG and self-checked.
    // Real images are always full size (1000×1500); only labelled placeholders are kept small.
    // AI pins are quality-checked; a weak photo (blurry, dark, low-res, headline hard to read) is remade once.
    const generate = () => withRetry(() => provider.generate(fullPrompt, PIN_IMAGE_SIZE), 2, 400);
    let attempts = 0;
    let image: Awaited<ReturnType<typeof brandPinImage>>;
    if (pagePhotoRaw) image = await brandPinImage(pagePhotoRaw, title, art, { angle });
    else ({ image, attempts } = await bestPinImage(generate, title, art, { angle }));

    const tImage = Date.now();
    let imagePath: string;
    let imageUrl: string;
    if (ctx.mode === "supabase") {
      imagePath = `${workspaceId}/${draftId}-${Date.now()}.${image.extension}`;
      const up = await ctx.db.storage.from(IMAGE_BUCKET).upload(imagePath, image.bytes, { contentType: image.contentType, upsert: false });
      if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
      const [upd, signed] = await Promise.all([
        ctx.db.from("pin_drafts").update({ image_status: "ready", image_path: imagePath, image_source: image.source }).eq("id", draftId).eq("workspace_id", workspaceId),
        ctx.db.storage.from(IMAGE_BUCKET).createSignedUrl(imagePath, 60 * 60),
      ]);
      if (upd.error) throw new Error(upd.error.message);
      if (signed.error) throw new Error(signed.error.message);
      imageUrl = signed.data.signedUrl;
    } else {
      // Demo storage: the browser keeps the image (in IndexedDB), so send it back inline.
      imageUrl = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
      imagePath = imageUrl;
    }

    await ctx.ledger.record({
      workspace_id: workspaceId, workspace_kind: workspace, kind: "image", provider: image.provider, model: image.model, source: image.source,
      input_tokens: 0, output_tokens: 0, images: attempts, est_cost_usd: image.est_cost_usd * attempts, status: "ok", error: null,
    });
    // Where the time went, so slow pins can be traced in the Vercel logs.
    const timings = { prep_ms: tPrep - tStart, image_ms: tImage - tPrep, save_ms: Date.now() - tImage, total_ms: Date.now() - tStart, images: attempts };
    console.info(JSON.stringify({ event: "image_timing", provider: image.provider, ...timings }));
    return NextResponse.json(
      { source: image.source, provider: image.provider, image_status: "ready", image_path: imagePath, image_url: imageUrl, design: image.design, notice, timings },
      { headers: { "Server-Timing": `prep;dur=${timings.prep_ms}, image;dur=${timings.image_ms}, save;dur=${timings.save_ms}` } },
    );
  } catch (err) {
    if (!(err instanceof HttpError && (err.status === 404 || err.status === 409))) await markFailed().catch(() => {});
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message }, { status: 402 });
    await ctx.ledger
      .record({
        workspace_id: workspaceId, workspace_kind: workspace, kind: "image", provider: provider.name, model: null, source: provider.source,
        input_tokens: 0, output_tokens: 0, images: 0, est_cost_usd: 0, status: "error", error: (err as Error).message,
      })
      .catch(() => {});
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: err.status });
    return errorResponse(err, request, "Image generation failed. Please retry.", { workspace, provider: provider.name });
  }
}
