import { z } from "zod";
import { PIN_ANGLES, anglesFor } from "@/lib/drafts/angles";
import { DraftSetSchema, LIMITS } from "@/lib/drafts/validation";
import type { GenerateRequest, GenerateResponse } from "@/lib/types";
import { BRAND_SYSTEM, BrandAnalysisSchema, brandUserPrompt, BOARDS_SYSTEM, DRAFTS_SYSTEM, INSIGHTS_SYSTEM, InsightsSchema, boardsUserPrompt, draftsUserPrompt, insightsUserPrompt, type BoardsPromptInput } from "./prompt";
import { AiAssignmentSetSchema } from "@/lib/boards/automation";
import { ProviderError, type BoardsOutput, type BrandOutput, type InsightsInput, type InsightsOutput, type TextProvider } from "./types";

export const CLOUDFLARE_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

interface Options {
  accountId: string;
  apiToken: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

/** Models sometimes run a little over Pinterest's limits; trim instead of failing the whole set. */
export function normalizeDrafts(raw: unknown, angles: readonly { label: string }[] = PIN_ANGLES): unknown {
  const drafts = (raw as { drafts?: unknown[] } | null)?.drafts;
  if (!Array.isArray(drafts)) return raw;
  return {
    drafts: drafts.slice(0, 5).map((d, i) => {
      const x = (d ?? {}) as Record<string, unknown>;
      const tags = (Array.isArray(x.tags) ? x.tags : String(x.tags ?? "").split(","))
        .map((t) => String(t).replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, LIMITS.tags);
      return {
        angle: angles[i]?.label ?? clip(x.angle, 60),
        concept: clip(x.concept, 400),
        title: clip(x.title, LIMITS.title),
        description: clip(x.description, LIMITS.description),
        tags,
        alt_text: clip(x.alt_text, LIMITS.alt_text),
        image_prompt: clip(x.image_prompt, 1200),
      };
    }),
  };
}

/**
 * Cloudflare Workers AI text adapter (free daily allocation, shared with
 * Workers AI images). Uses JSON mode so the five drafts come back as data.
 * POST /accounts/{id}/ai/run/{model} with messages + response_format.
 */
export class CloudflareTextProvider implements TextProvider {
  readonly source = "ai" as const;
  readonly name: string;
  private readonly model: string;

  constructor(private readonly opts: Options) {
    this.model = opts.model || CLOUDFLARE_TEXT_MODEL;
    this.name = `Cloudflare ${this.model.replace(/^@[^/]+\/[^/]+\//, "")}`;
  }

  private async run(system: string, user: string, schema: z.ZodType, maxTokens: number, timeoutMs = 90_000) {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.opts.accountId)}/ai/run/${this.model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: `${system}\nReply with JSON only, matching the given schema.` },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: z.toJSONSchema(schema) },
          max_tokens: maxTokens,
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError")
        throw new ProviderError(`The text AI took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Please retry; non-English pins take longer.`, 504, true);
      throw new ProviderError(`Text AI unreachable: ${(e as Error).message}`, 502, true);
    }
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      result?: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      errors?: { message?: string }[];
    } | null;
    if (!res.ok || body?.success === false) {
      const msg = body?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new ProviderError("Cloudflare rejected the credentials for text AI. Check CLOUDFLARE_API_TOKEN (needs Workers AI permission).", 502, false);
      if (res.status === 429 || /neuron|limit|quota/i.test(msg)) throw new ProviderError(`Cloudflare's daily free AI allowance is used up; it resets daily. (${msg})`, 429, false);
      throw new ProviderError(`Text generation failed: ${msg}`, res.status >= 500 ? 503 : 502, res.status >= 500);
    }
    let out = body?.result?.response;
    if (typeof out === "string") {
      try {
        out = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new ProviderError("The AI reply wasn't valid JSON. Please retry.", 502, true);
      }
    }
    return { out, usage: { input_tokens: body?.result?.usage?.prompt_tokens ?? 0, output_tokens: body?.result?.usage?.completion_tokens ?? 0 } };
  }

  async generateDrafts(req: GenerateRequest): Promise<GenerateResponse> {
    // Urdu, Arabic, Hindi etc. use several tokens per word: give them room so the JSON isn't cut off.
    const nonEnglish = Boolean(req.language && !/^english$/i.test(req.language) && !/^roman/i.test(req.language));
    const { out, usage } = await this.run(DRAFTS_SYSTEM, draftsUserPrompt(req), DraftSetSchema, nonEnglish ? 6500 : 4000, 100_000);
    const parsed = DraftSetSchema.safeParse(normalizeDrafts(out, anglesFor(req.style)));
    if (!parsed.success) throw new ProviderError("The AI returned incomplete drafts. Please retry.", 502, true);
    return { source: "ai", provider: this.name, model: this.model, drafts: parsed.data.drafts, usage };
  }

  async generateInsights(input: InsightsInput): Promise<InsightsOutput> {
    const { out, usage } = await this.run(INSIGHTS_SYSTEM, insightsUserPrompt(input), InsightsSchema, 3000);
    const parsed = InsightsSchema.safeParse(out);
    if (!parsed.success) throw new ProviderError("The AI response was incomplete. Please retry.", 502, true);
    return { insights: parsed.data.insights, model: this.model, usage };
  }

  async assignBoards(input: BoardsPromptInput): Promise<BoardsOutput> {
    const { out, usage } = await this.run(BOARDS_SYSTEM, boardsUserPrompt(input), AiAssignmentSetSchema, 4000);
    const parsed = AiAssignmentSetSchema.safeParse(out);
    if (!parsed.success) throw new ProviderError("The AI board picks were incomplete. Please retry.", 502, true);
    return { assignments: parsed.data.assignments, model: this.model, usage };
  }

  async analyzeBrand(pageText: string): Promise<BrandOutput> {
    const { out, usage } = await this.run(BRAND_SYSTEM, brandUserPrompt(pageText), BrandAnalysisSchema, 1200, 45_000);
    const parsed = BrandAnalysisSchema.safeParse(out);
    if (!parsed.success) throw new ProviderError("The AI brand analysis was incomplete. Please retry.", 502, true);
    return { brand: parsed.data, model: this.model, usage };
  }
}
