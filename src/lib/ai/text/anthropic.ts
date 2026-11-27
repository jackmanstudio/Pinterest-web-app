import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DraftSetSchema } from "@/lib/drafts/validation";
import type { GenerateRequest, GenerateResponse } from "@/lib/types";
import { ProviderError, type BrandOutput, type BoardsOutput, type InsightsInput, type InsightsOutput, type PhotoPinsOutput, type TextProvider } from "./types";

import { BRAND_SYSTEM, BrandAnalysisSchema, brandUserPrompt, BOARDS_SYSTEM, DRAFTS_SYSTEM as SYSTEM, INSIGHTS_SYSTEM, InsightsSchema, boardsUserPrompt, draftsUserPrompt, insightsUserPrompt, PHOTO_SYSTEM, PhotoPinSetSchema, photoUserPrompt, type BoardsPromptInput, type PhotoPinsInput } from "./prompt";
import { AiAssignmentSetSchema } from "@/lib/boards/automation";

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
            content: insightsUserPrompt(input),
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

  async analyzeBrand(pageText: string): Promise<BrandOutput> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4000,
        system: BRAND_SYSTEM,
        messages: [{ role: "user", content: brandUserPrompt(pageText) }],
        output_config: { effort: "low", format: betaZodOutputFormat(BrandAnalysisSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") throw new ProviderError("The AI provider declined this request.", 422);
      if (!response.parsed_output) throw new ProviderError("The AI brand analysis was incomplete. Please retry.", 502, true);
      return { brand: response.parsed_output, model: response.model, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("The AI provider is rate limiting requests. Retry shortly.", 429, true);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`The AI provider returned an error (${err.status ?? "network"}).`, 502, true);
      throw err;
    }
  }

  async describePhotos(input: PhotoPinsInput, images: { base64: string; mediaType: "image/jpeg" }[]): Promise<PhotoPinsOutput> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        system: PHOTO_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images.flatMap((img, i) => [
                { type: "text" as const, text: `Photo ${i + 1}:` },
                { type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } },
              ]),
              { type: "text" as const, text: photoUserPrompt(input) },
            ],
          },
        ],
        output_config: { effort: "low", format: betaZodOutputFormat(PhotoPinSetSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") throw new ProviderError("The AI provider declined one of these photos.", 422);
      if (!response.parsed_output || response.parsed_output.pins.length < images.length) throw new ProviderError("The AI pin text was incomplete. Please retry.", 502, true);
      return { pins: response.parsed_output.pins.slice(0, images.length), model: response.model, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("The AI provider is rate limiting requests. Retry shortly.", 429, true);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`The AI provider returned an error (${err.status ?? "network"}).`, 502, true);
      throw err;
    }
  }

  async assignBoards(input: BoardsPromptInput): Promise<BoardsOutput> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: BOARDS_SYSTEM,
        messages: [{ role: "user", content: boardsUserPrompt(input) }],
        output_config: { effort: "low", format: betaZodOutputFormat(AiAssignmentSetSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") throw new ProviderError("The AI provider declined this request.", 422);
      if (!response.parsed_output) throw new ProviderError("The AI board picks were incomplete. Please retry.", 502, true);
      return {
        assignments: response.parsed_output.assignments,
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
    const user = draftsUserPrompt(req);

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
