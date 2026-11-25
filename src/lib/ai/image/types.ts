export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  source: "demo" | "ai";
  provider: string;
  model: string | null;
  est_cost_usd: number;
}

/** Server-side image provider adapter. Real providers plug in behind this. */
export interface ImageProvider {
  readonly name: string;
  readonly source: "demo" | "ai";
  generate(prompt: string, size: { width: number; height: number }): Promise<GeneratedImage>;
}

/** Pinterest's recommended 2:3 pin size. */
export const PIN_IMAGE_SIZE = { width: 1000, height: 1500 } as const;

/** Private Supabase Storage bucket; objects live under <workspace_id>/. */
export const IMAGE_BUCKET = "pin-images";
