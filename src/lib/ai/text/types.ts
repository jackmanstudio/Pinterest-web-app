import type { AiAssignment } from "@/lib/boards/automation";
import type { BoardsPromptInput, BrandAnalysis } from "./prompt";
import type { GenerateRequest, GenerateResponse } from "@/lib/types";

/**
 * Server-side text provider adapter. Swap providers by adding another
 * implementation; routes only ever talk to this interface.
 */
export interface TextProvider {
  /** Human-readable provider name shown in the UI. */
  readonly name: string;
  /** "demo" providers produce template text and must be labelled as such. */
  readonly source: "demo" | "ai";
  generateDrafts(req: GenerateRequest): Promise<GenerateResponse>;
  /** Analytics insights. Demo providers don't implement this: we never invent analysis. */
  generateInsights?(input: InsightsInput): Promise<InsightsOutput>;
  /** Board & category picks (spec 11). Demo providers don't implement this; the keyword fallback is used instead. */
  assignBoards?(input: BoardsPromptInput): Promise<BoardsOutput>;
  /** Brand voice, audience, keywords, image style and CTA from a website's text. */
  analyzeBrand?(pageText: string): Promise<BrandOutput>;
}

export interface BrandOutput {
  brand: BrandAnalysis;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface BoardsOutput {
  assignments: AiAssignment[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface InsightsInput {
  workspace: string;
  dateRange: { start: string | null; end: string | null };
  data: unknown;
}

export interface InsightsOutput {
  insights: { title: string; detail: string; evidence: string; action: string }[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** An error that is safe to show the user (no secrets, no stack). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
