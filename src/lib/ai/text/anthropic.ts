import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PIN_ANGLES } from "@/lib/drafts/angles";
import { DraftSetSchema, LIMITS } from "@/lib/drafts/validation";
import type { GenerateRequest, GenerateResponse } from "@/lib/types";
import { z } from "zod";
import { ProviderError, type InsightsInput, type InsightsOutput, type TextProvider } from "./types";

const SYSTEM = `You write Pinterest pin copy for a content studio.
For each request you produce exactly five pin drafts, one per creative angle, in the order given.
The five drafts must be meaningfully different: different hook, different promise, different visual. Never reuse a title structure.
Respect Pinterest limits: title <= ${LIMITS.title} characters, description <= ${LIMITS.description} characters, alt text <= ${LIMITS.alt_text} characters, 3-${LIMITS.tags} tags.
Descriptions read naturally, include relevant search keywords, and end with a soft call to save or click. No hashtags inside descriptions.
Alt text literally describes what the image shows for screen-reader users.
The image prompt (2-4 sentences) is for a photo-realistic image model and must literally depict the subject of that draft's title: who or what is shown, the setting, styling, colours, mood and camera framing.
Describe ONE cohesive photographic scene. Never ask for collages, grids, split screens, before/after layouts, numbered panels, text, words, numbers or logos: the title is added on top of the image later.
Make the five image prompts visually distinct, e.g. a styled flat lay, a person wearing or using it in a real setting, a close-up detail shot, a location or lifestyle scene, and a seasonal set-up.
Write like a sharp human editor, not a template: use specific, vivid details from the idea, fresh wording and a clear promise. Avoid generic filler and clichés such as "elevate your style", "must-have", "game-changer", "look no further", "take it to the next level", "effortlessly chic", and avoid clickbait.
Never use any word from the brand's banned list. Do not invent facts, prices, or claims about products.`;

const InsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        evidence: z.string(),
        action: z.string(),
      }),
    )
    .max(6),
});

const INSIGHTS_SYSTEM = `You analyse Pinterest analytics for a content studio.
Use ONLY the JSON data provided. Never invent metrics, benchmarks, competitor figures or trends that are not in the data.
Every number you mention must appear in the data exactly (you may round to 1 decimal or show a rate as a percentage).
In "evidence", name the metric(s) and value(s) you relied on. If the data is too thin to conclude anything, return fewer insights or none.
Actions must be concrete next steps for pin content (topics, formats, timing) grounded in the evidence.`;

export class AnthropicTextProvider implements TextProvider {
  readonly name = "Claude (Anthropic)";
  readonly source = "ai" as const;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  }

  async generateInsights(input: InsightsInput): Promise<InsightsOutput> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: INSIGHTS_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Workspace: ${input.workspace}\nDate range (UTC): ${input.dateRange.start} to ${input.dateRange.end}\n\nData:\n${JSON.stringify(input.data)}`,
          },
        ],
        output_config: { effort: "medium", format: betaZodOutputFormat(InsightsSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") throw new ProviderError("The AI provider declined this request.", 422);
      if (!response.parsed_output) throw new ProviderError("The AI response was incomplete. Please retry.", 502, true);
      return {
        insights: response.parsed_output.insights,
        model: response.model,
        usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("The AI provider is rate limiting requests. Retry shortly.", 429, true);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`The AI provider returned an error (${err.status ?? "network"}).`, 502, true);
      throw err;
    }
  }

  async generateDrafts(req: GenerateRequest): Promise<GenerateResponse> {
    const angles = PIN_ANGLES.map((a, i) => `${i + 1}. ${a.label}: ${a.brief}`).join("\n");
    const b = req.brand;
    const brand = [
      b.brand_name && `Brand: ${b.brand_name}`,
      b.voice && `Voice: ${b.voice}`,
      b.audience && `Audience: ${b.audience}`,
      b.focus_keywords.length && `Focus keywords: ${b.focus_keywords.join(", ")}`,
      b.banned_words.length && `Banned words: ${b.banned_words.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const user = `Workspace: ${req.workspace}
${req.category ? `Category: ${req.category}\n` : ""}${brand ? `${brand}\n` : ""}
Pin idea: ${req.idea}

Angles (one draft each, set "angle" to the angle label):
${angles}`;

    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: betaZodOutputFormat(DraftSetSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        throw new ProviderError("The AI provider declined this idea. Try rewording it.", 422);
      }
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        throw new ProviderError("The AI response was incomplete. Please retry.", 502, true);
      }
      return {
        source: "ai",
        provider: this.name,
        model: response.model,
        drafts: response.parsed_output.drafts,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError("The text AI key was rejected. Check TEXT_AI_API_KEY.", 500);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError("The AI provider is rate limiting requests. Wait a minute and retry.", 429, true);
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new ProviderError("The AI provider rejected the request.", 502);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(`The AI provider returned an error (${err.status ?? "network"}). Please retry.`, 502, true);
      }
      throw err;
    }
  }
}
