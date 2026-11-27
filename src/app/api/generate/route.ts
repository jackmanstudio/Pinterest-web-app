import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import { findNearDuplicates } from "@/lib/drafts/distinctness";
import { tidyDrafts } from "@/lib/drafts/tidyTitle";
import { fixDraftSpelling } from "@/lib/ai/text/glossary";
import { cleanDrafts, draftsHaveStray } from "@/lib/ai/text/script";
import { polishSeo } from "@/lib/seo/polish";
import { GenerateRequestSchema } from "@/lib/drafts/validation";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import type { UsageEntry } from "@/lib/usage/ledger";
import { estimateTextCost } from "@/lib/usage/pricing";
import type { GenerateResponse } from "@/lib/types";
import { errorResponse } from "@/lib/server/errors";

// Non-English pins can take over a minute on the free text model.
export const maxDuration = 150;

export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "generate");
  if (limitedRes) return limitedRes;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  let usageBase: Omit<UsageEntry, "input_tokens" | "output_tokens" | "est_cost_usd" | "status" | "error"> | null = null;
  let ledger: Awaited<ReturnType<typeof getRequestContext>>["ledger"] | null = null;
  try {
    const ctx = await getRequestContext();
    ledger = ctx.ledger;
    const workspaceId = await workspaceIdFor(ctx, parsed.data.workspace);
    const provider = getTextProvider();
    usageBase = { workspace_id: workspaceId, workspace_kind: parsed.data.workspace, kind: "text", provider: provider.name, model: null, source: provider.source, images: 0 };
    await assertWithinBudget(ctx.ledger, provider.source === "ai");

    const tokens = { input: 0, output: 0 };
    const run = async () => {
      const r = await provider.generateDrafts(parsed.data);
      const lang = parsed.data.language || parsed.data.brand.language;
      r.drafts = fixDraftSpelling(tidyDrafts(r.drafts, parsed.data.idea, lang), lang);
      tokens.input += r.usage?.input_tokens ?? 0;
      tokens.output += r.usage?.output_tokens ?? 0;
      return r;
    };
    const started = Date.now();
    let result: GenerateResponse = await run();
    // One bounded retry if the model returned near-duplicates, only when the first call was quick
    // (a second slow call would keep the user waiting minutes).
    if (result.source === "ai" && findNearDuplicates(result.drafts).length > 0 && Date.now() - started < 12_000) result = await run();
    // Stray letters from another script (e.g. Chinese inside Urdu): retry once if there is time, then strip them.
    const lang = parsed.data.language || parsed.data.brand.language;
    if (result.source === "ai" && draftsHaveStray(result.drafts, lang) && Date.now() - started < 20_000) {
      const again = await run().catch(() => null);
      if (again && !draftsHaveStray(again.drafts, lang)) result = again;
    }
    result = {
      ...result,
      drafts: polishSeo(cleanDrafts(result.drafts, lang), {
        idea: parsed.data.idea,
        category: parsed.data.category,
        trendKeywords: parsed.data.trend_keywords,
        focusKeywords: parsed.data.brand.focus_keywords,
        language: lang,
      }),
    };

    const cost = estimateTextCost(result.model, tokens.input, tokens.output);
    await ctx.ledger.record({ ...usageBase, model: result.model, input_tokens: tokens.input, output_tokens: tokens.output, est_cost_usd: cost, status: "ok", error: null });

    const duplicates = findNearDuplicates(result.drafts);
    return NextResponse.json({
      ...result,
      usage: { input_tokens: tokens.input, output_tokens: tokens.output },
      est_cost_usd: cost,
      warnings: duplicates.length ? ["Some drafts are similar; consider editing them."] : [],
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, retryable: false }, { status: 402 });
    if (ledger && usageBase) {
      await ledger
        .record({ ...usageBase, input_tokens: 0, output_tokens: 0, est_cost_usd: 0, status: "error", error: (err as Error).message })
        .catch(() => {});
    }
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: err.status });
    }
    return errorResponse(err, request, "Generation failed. Please retry.");
  }
}
