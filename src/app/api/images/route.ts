import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getImageProvider } from "@/lib/ai/image";
import { IMAGE_BUCKET, PIN_IMAGE_SIZE } from "@/lib/ai/image/types";
import { withRetry } from "@/lib/ai/retry";
import { ProviderError } from "@/lib/ai/text/types";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { WORKSPACE_KINDS } from "@/lib/types";
import { brandArtFor, brandPinImage, logoFromDataUrl, type BrandArt } from "@/lib/brand/server";
import { readTemplate } from "@/lib/brand/template";
import { buildImagePrompt } from "@/lib/ai/image/prompt";

const Body = z.object({
  workspace: z.enum(WORKSPACE_KINDS),
  draftId: z.string().min(1).max(64),
  // Only used in Demo storage mode, where the server can't read the draft or brand.
  prompt: z.string().max(2000).optional(),
  title: z.string().max(200).optional(),
  angle: z.string().max(80).optional(),
  template: z.unknown().optional(),
  imageStyle: z.string().max(120).optional(),
});

export async function POST(request: Request) {
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
  let markFailed = async () => {};
  try {
    workspaceId = await workspaceIdFor(ctx, workspace);
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
      art = await brandArtFor(ctx.db, workspaceId!);
      const { data: b } = await ctx.db.from("brand_settings").select("image_style").eq("workspace_id", workspaceId).maybeSingle();
      imageStyle = (b?.image_style as string | undefined) ?? "";
      await ctx.db.from("pin_drafts").update({ image_status: "pending" }).eq("id", draftId).eq("workspace_id", workspaceId);
      markFailed = async () => {
        await ctx.db.from("pin_drafts").update({ image_status: "failed" }).eq("id", draftId).eq("workspace_id", workspaceId);
      };
    }
    else {
      const template = readTemplate(parsed.data.template);
      art = { template, logo: logoFromDataUrl(template.logo) };
    }
    if (!prompt.trim()) throw new HttpError(400, "Add an image prompt first");

    await assertWithinBudget(ctx.ledger, provider.source === "ai");
    const fullPrompt = buildImagePrompt({ title, scene: prompt, kind: workspace, overlay: art.template.style, angle, palette: art.template.palette, imageStyle });
    // Headline, palette, brand and logo are drawn on the server, then saved as one JPEG and self-checked.
    let attempts = 1;
    let image = await brandPinImage(await withRetry(() => provider.generate(fullPrompt, PIN_IMAGE_SIZE)), title, art, { demo: ctx.mode === "demo", angle });
    if (image.source === "ai" && image.design.retryPhoto) {
      // The photo itself was weak (blurry or badly exposed): make one more and keep the better pin.
      attempts = 2;
      const second = await brandPinImage(await withRetry(() => provider.generate(fullPrompt, PIN_IMAGE_SIZE)), title, art, { angle }).catch(() => null);
      if (second && second.design.score > image.design.score) image = second;
    }

    let imagePath: string;
    let imageUrl: string;
    if (ctx.mode === "supabase") {
      imagePath = `${workspaceId}/${draftId}-${Date.now()}.${image.extension}`;
      const up = await ctx.db.storage.from(IMAGE_BUCKET).upload(imagePath, image.bytes, { contentType: image.contentType, upsert: false });
      if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
      const upd = await ctx.db
        .from("pin_drafts")
        .update({ image_status: "ready", image_path: imagePath, image_source: image.source })
        .eq("id", draftId)
        .eq("workspace_id", workspaceId);
      if (upd.error) throw new Error(upd.error.message);
      const signed = await ctx.db.storage.from(IMAGE_BUCKET).createSignedUrl(imagePath, 60 * 60);
      if (signed.error) throw new Error(signed.error.message);
      imageUrl = signed.data.signedUrl;
    } else {
      // Demo storage keeps the (small, labelled) placeholder inline in the browser.
      imageUrl = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
      imagePath = imageUrl;
    }

    await ctx.ledger.record({
      workspace_id: workspaceId, workspace_kind: workspace, kind: "image", provider: image.provider, model: image.model, source: image.source,
      input_tokens: 0, output_tokens: 0, images: attempts, est_cost_usd: image.est_cost_usd * attempts, status: "ok", error: null,
    });
    return NextResponse.json({ source: image.source, provider: image.provider, image_status: "ready", image_path: imagePath, image_url: imageUrl, design: image.design });
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
    console.error("image generation failed", err);
    return NextResponse.json({ error: "Image generation failed. Please retry.", retryable: true }, { status: 500 });
  }
}
