import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import {
  BOARD_MODES,
  CONTENT_CATEGORIES,
  MAX_BULK_KEYWORDS,
  MAX_RULES,
  SAMPLE_BOARDS,
  acceptAiAssignment,
  keywordAssign,
  presetAssignments,
  type Assignment,
  type Board,
} from "@/lib/boards/automation";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { estimateTextCost } from "@/lib/usage/pricing";
import { WORKSPACE_KINDS, type Category } from "@/lib/types";
import { detectCategory } from "@/lib/categories/taxonomy";

const s = (n: number) => z.string().max(n);
const Body = z.object({
  workspace: z.enum(WORKSPACE_KINDS),
  pins: z
    .array(z.object({ key: s(64).min(1), keyword: s(200), title: s(200).optional(), description: s(800).optional(), tags: z.array(s(60)).max(20).optional(), alt_text: s(500).optional() }))
    .min(1)
    .max(MAX_BULK_KEYWORDS),
  /** The workspace's own category names: picks use these when given. */
  categories: z.array(s(170)).max(200).optional(),
  settings: z.object({
    mode: z.enum(BOARD_MODES),
    manual_board_id: s(64).nullable(),
    manual_board_name: s(180).nullable(),
    rules: z.array(z.object({ keyword: s(100), board_id: s(64), board_name: s(180) })).max(MAX_RULES),
    keyword_plan: z.array(z.object({ keyword: s(100), category: s(80), board_id: s(64).nullable(), board_name: s(180).nullable() })).max(MAX_BULK_KEYWORDS),
  }),
});

/**
 * Picks a board and content category for each pin (spec 11). Read-only: it
 * never creates boards or changes anything on Pinterest. Boards come from the
 * account's own synced list on the server; demo mode uses labelled samples.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "generate");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { workspace, pins, settings } = parsed.data;
  const own = (parsed.data.categories ?? []).filter(Boolean);
  const ownCats = own.map((name, i) => ({ id: String(i), name, parent_id: null }) as unknown as Category);
  // Name the category from the workspace's own list when it has one.
  const withOwnCategory = (a: Assignment): Assignment => {
    if (!own.length) return a;
    const exact = own.find((n) => n.toLowerCase() === a.category.toLowerCase());
    if (exact) return { ...a, category: exact };
    const pin = pins.find((p) => p.key === a.key);
    const hit = pin ? detectCategory([pin.keyword, pin.title, pin.tags?.join(" "), pin.description].filter(Boolean).join(" "), ownCats) : null;
    return { ...a, category: hit?.category.name ?? a.category };
  };

  try {
    const ctx = await getRequestContext();
    const workspaceId = await workspaceIdFor(ctx, workspace);
    let boards: Board[] = [];
    if (ctx.mode === "supabase") {
      const res = await ctx.db.from("pinterest_boards").select("board_id, name, description, privacy, pin_count").eq("workspace_id", workspaceId!).order("name");
      if (res.error) throw new Error(res.error.message);
      boards = res.data ?? [];
    }
    const sample = boards.length === 0;
    if (sample) boards = SAMPLE_BOARDS[workspace];

    const { done, rest } = presetAssignments(pins, settings, boards);
    let assignments: Assignment[] = [...done];
    let engine: "ai" | "keyword" | "none" = rest.length ? "keyword" : "none";
    let provider: string | null = null;
    let note: string | null = null;

    if (rest.length) {
      const p = getTextProvider();
      provider = p.name;
      if (p.source === "ai" && p.assignBoards) {
        await assertWithinBudget(ctx.ledger, true);
        try {
          const out = await p.assignBoards({ workspace, categories: own.length ? own : Object.keys(CONTENT_CATEGORIES), boards, pins: rest });
          const byKey = new Map(out.assignments.map((a) => [a.key, a]));
          for (const pin of rest) {
            const a = byKey.get(pin.key);
            assignments.push(a ? acceptAiAssignment(a, pin, boards) : keywordAssign(pin, boards));
          }
          engine = "ai";
          const cost = estimateTextCost(out.model, out.usage.input_tokens, out.usage.output_tokens);
          await ctx.ledger
            .record({ workspace_id: workspaceId, workspace_kind: workspace, kind: "text", provider: p.name, model: out.model, source: "ai", images: 0, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, est_cost_usd: cost, status: "ok", error: null })
            .catch(() => {});
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err;
          note = `AI board picking failed (${err.message}), so keyword matching was used.`;
          assignments.push(...rest.map((pin) => keywordAssign(pin, boards)));
        }
      } else {
        note = "Text AI isn't configured, so boards were matched by keywords. Add an AI key for smarter picks.";
        assignments.push(...rest.map((pin) => keywordAssign(pin, boards)));
      }
    }
    // Keep the caller's order.
    const order = new Map(pins.map((p, i) => [p.key, i]));
    assignments = assignments.map(withOwnCategory).sort((a, b) => order.get(a.key)! - order.get(b.key)!);
    return NextResponse.json({ assignments, boards, sampleBoards: sample, engine, provider, note });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error("board assign failed", err);
    return NextResponse.json({ error: "Board assignment failed. Please retry." }, { status: 500 });
  }
}
