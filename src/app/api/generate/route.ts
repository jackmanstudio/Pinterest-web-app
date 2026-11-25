import { NextResponse } from "next/server";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import { findNearDuplicates } from "@/lib/drafts/distinctness";
import { GenerateRequestSchema } from "@/lib/drafts/validation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { GenerateResponse } from "@/lib/types";

export async function POST(request: Request) {
  if (isSupabaseConfigured) {
    const supabase = await getServerSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

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

  try {
    const provider = getTextProvider();
    let result: GenerateResponse = await provider.generateDrafts(parsed.data);
    // One bounded retry if the model returned near-duplicates.
    if (result.source === "ai" && findNearDuplicates(result.drafts).length > 0) {
      result = await provider.generateDrafts(parsed.data);
    }
    const duplicates = findNearDuplicates(result.drafts);
    return NextResponse.json({ ...result, warnings: duplicates.length ? ["Some drafts are similar; consider editing them."] : [] });
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: err.status });
    }
    console.error("generate failed", err);
    return NextResponse.json({ error: "Generation failed. Please retry." }, { status: 500 });
  }
}
