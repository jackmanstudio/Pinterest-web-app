import { connection, NextResponse } from "next/server";
import { getTextProvider } from "@/lib/ai/text";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Integration status for the UI. Never returns secret values. */
export async function GET() {
  await connection(); // read env at request time, not build time
  const text = getTextProvider();
  return NextResponse.json({
    storage: isSupabaseConfigured ? "supabase" : "demo",
    text: { source: text.source, provider: text.name },
    image: { status: "not_connected" },
    pinterest: { status: "not_connected" },
  });
}
