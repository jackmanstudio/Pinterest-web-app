"use client";
import {
  SAMPLE_BOARDS,
  type Assignment,
  type Board,
  type BoardPlan,
  type BoardSettings,
  type PinFacts,
} from "@/lib/boards/automation";
import type { Store } from "@/lib/store";
import type { PinDraft, WorkspaceKind } from "@/lib/types";

export interface BoardSource {
  boards: Board[];
  /** true = labelled demo sample boards (no Pinterest account connected or no boards synced). */
  sample: boolean;
  username: string | null;
  active: boolean;
  ready: boolean;
  env: "sandbox" | "production";
  scopes: string[];
}

/** The account's synced boards, or demo sample boards until Pinterest is connected. */
export async function loadBoardSource(kind: WorkspaceKind): Promise<BoardSource> {
  const fallback: BoardSource = { boards: SAMPLE_BOARDS[kind], sample: true, username: null, active: false, ready: false, env: "sandbox", scopes: [] };
  try {
    const s = await (await fetch(`/api/pinterest/status?workspace=${kind}`)).json();
    if (s.error) return fallback;
    const boards: Board[] = (s.boards ?? []).map((b: Board) => ({ board_id: b.board_id, name: b.name, description: b.description ?? null, privacy: b.privacy ?? null, pin_count: b.pin_count ?? null }));
    return {
      boards: boards.length ? boards : SAMPLE_BOARDS[kind],
      sample: boards.length === 0,
      username: s.connection?.username ?? null,
      active: s.connection?.status === "active",
      ready: Boolean(s.config?.ready),
      env: s.config?.env ?? "sandbox",
      scopes: s.connection?.scopes ?? [],
    };
  } catch {
    return fallback;
  }
}

export const draftFacts = (d: PinDraft): PinFacts => ({ key: d.id, keyword: d.idea, title: d.title, description: d.description, tags: d.tags, alt_text: d.alt_text });

export interface AssignResult {
  assignments: Assignment[];
  boards: Board[];
  sampleBoards: boolean;
  engine: "ai" | "keyword" | "none";
  note: string | null;
}

/** Asks the server for board + category picks, 50 pins per request. */
export async function requestAssignments(kind: WorkspaceKind, pins: PinFacts[], settings: BoardSettings): Promise<AssignResult> {
  const out: AssignResult = { assignments: [], boards: [], sampleBoards: false, engine: "none", note: null };
  for (let i = 0; i < pins.length; i += 50) {
    const res = await fetch("/api/boards/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: kind, pins: pins.slice(i, i + 50), settings }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Board assignment failed (${res.status})`);
    out.assignments.push(...body.assignments);
    out.boards = body.boards;
    out.sampleBoards = body.sampleBoards;
    if (body.engine !== "none") out.engine = body.engine;
    out.note = body.note ?? out.note;
  }
  return out;
}

export const toPlan = (a: Assignment): BoardPlan | null =>
  a.board_id && a.board_name
    ? { draft_id: a.key, board_id: a.board_id, board_name: a.board_name, category: a.category, reason: a.reason, method: a.method, confidence: a.confidence }
    : null;

/**
 * Automatic mode after generating pins: plan a board for each new pin in the
 * background. It's only a plan (nothing goes to Pinterest); Custom mode skips
 * it because the user picks each board.
 */
export async function autoPlanBoards(store: Store, workspaceId: string, kind: WorkspaceKind, drafts: PinDraft[]): Promise<number> {
  if (!drafts.length) return 0;
  const settings = await store.getBoardSettings(workspaceId);
  if (settings.mode === "custom") return 0;
  const r = await requestAssignments(kind, drafts.map(draftFacts), settings);
  const plans = r.assignments.map(toPlan).filter((p): p is BoardPlan => p !== null);
  await store.saveBoardPlans(workspaceId, plans);
  return plans.length;
}
