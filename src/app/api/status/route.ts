import { connection, NextResponse } from "next/server";
import { getImageProvider } from "@/lib/ai/image";
import { getTextProvider } from "@/lib/ai/text";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Integration status for the UI. Never returns secret values. */
export async function GET() {
  await connection(); // read env at request time, not build time
  const text = getTextProvider();
  let image: { source: "demo" | "ai" | "error"; provider: string };
  try {
    const p = getImageProvider();
    image = { source: p.source, provider: p.name };
  } catch (e) {
    image = { source: "error", provider: (e as Error).message };
  }
  return NextResponse.json({
    storage: isSupabaseConfigured ? "supabase" : "demo",
    text: { source: text.source, provider: text.name },
    image,
    pinterest: { status: "not_connected" },
  });
}
