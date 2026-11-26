import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { extractPage, pageContext } from "@/lib/tools/pageExtract";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import type { BrandAnalysis } from "@/lib/ai/text/prompt";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { estimateTextCost } from "@/lib/usage/pricing";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { FetchBlocked, safeFetch } from "@/lib/tools/safeFetch";

const Body = z.object({ url: z.string().trim().min(4).max(2048), workspace: WorkspaceSlug.optional() });

/** Logo as a small PNG data URL (fits the pin template's size limit), or null. */
async function logoDataUrl(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    try {
      const r = await safeFetch(u, { accept: "image/png,image/jpeg,image/webp,image/svg+xml,image/*", maxBytes: 2_000_000, timeoutMs: 8000 });
      if (r.status >= 400) continue;
      const img = sharp(r.bytes, { density: 200 });
      const meta = await img.metadata();
      if (!meta.width || meta.width < 64) continue;
      const png = await img.resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
      if (png.length > 250_000) continue;
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Brand analysis from a website: name, description, keywords, colour and logo,
 * as suggestions the user reviews before saving. Read-only.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your website address first." }, { status: 400 });
  try {
    const ctx = await getRequestContext();
    const url = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;
    const res = await safeFetch(url, { accept: "text/html", maxBytes: 4_000_000 });
    if (res.status >= 400 || !/html/.test(res.contentType)) return NextResponse.json({ error: `Couldn't open that website (${res.status}).` }, { status: 422 });
    const page = extractPage(new TextDecoder().decode(res.bytes), res.url);
    const name = page.siteName ?? page.title.split(/\s[|–—-]\s/)[0].trim();

    // Voice, audience, keywords, image style and CTA need a text AI; without one we say so.
    let analysis: BrandAnalysis | null = null;
    let analysisNote: string | null = null;
    const p = getTextProvider();
    if (p.source === "ai" && p.analyzeBrand) {
      try {
        await assertWithinBudget(ctx.ledger, true);
        const out = await p.analyzeBrand(pageContext(page));
        // Small grammar fix the model sometimes misses ("a honest" → "an honest").
        const an = (t: string) => t.replace(/\b([Aa]) (honest|hour|heir|honou?r)/g, (_m, a: string, w: string) => `${a}n ${w}`);
        analysis = { ...out.brand, voice: an(out.brand.voice), audience: an(out.brand.audience), image_style: an(out.brand.image_style), cta: an(out.brand.cta) };
        await ctx.ledger
          .record({
            workspace_id: parsed.data.workspace ? ((await workspaceIdFor(ctx, parsed.data.workspace)) ?? null) : null, workspace_kind: parsed.data.workspace, kind: "text", provider: p.name, model: out.model, source: "ai", images: 0,
            input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, est_cost_usd: estimateTextCost(out.model, out.usage.input_tokens, out.usage.output_tokens), status: "ok", error: null,
          })
          .catch(() => {});
      } catch (e) {
        if (e instanceof BudgetExceededError) analysisNote = e.message;
        else if (e instanceof ProviderError) analysisNote = `AI analysis failed (${e.message}); only the basics were read from the page.`;
        else throw e;
      }
    } else {
      analysisNote = "Text AI isn't set up, so only the name, keywords, colour and logo were read. Voice, audience, image style and call to action need an AI key.";
    }
    return NextResponse.json({
      analysis,
      analysis_note: analysisNote,
      brand_name: name.slice(0, 80),
      description: page.description,
      keywords: analysis?.focus_keywords.length ? analysis.focus_keywords : page.keywords.length ? page.keywords : page.headings.slice(0, 5).map((h) => h.toLowerCase()).filter((h) => h.length < 30),
      color: page.themeColor,
      logo: await logoDataUrl(page.logos),
      language: page.language,
      website_url: new URL(res.url).origin,
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof FetchBlocked) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Couldn't read that website. It may block automated visitors." }, { status: 502 });
  }
}
