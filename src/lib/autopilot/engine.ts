import type { WorkspaceKind } from "@/lib/types";
import { localHour } from "./bestTime";

/**
 * Autopilot core. One call = one step for one workspace: publish at most one
 * pin, refilling the pin backlog from the idea queue when it runs dry.
 *
 * Built to grow into a fully automatic agent: ideas come from an IdeaSource
 * (today the user's queue; later Pinterest trends or an analytics-driven
 * agent can implement the same interface), and every step is a small,
 * replaceable dependency.
 */
export const CONSENT_PHRASE = "AUTO PUBLISH";
export const MAX_PINS_PER_DAY = 10;
const DAY_MS = 86_400_000;

export interface AutopilotWorkspace {
  workspace_id: string;
  owner_id: string;
  kind: WorkspaceKind;
  board_id: string;
  board_name: string | null;
  pins_per_day: number;
  link: string | null;
  timezone: string;
  best_time: boolean;
  remix_winners: boolean;
  auto_trends: boolean;
  trend_interest: string | null;
}

export interface Idea {
  id: string;
  idea: string;
}

/** Where ideas come from. Today: the user's queue. Later: trends, analytics, an agent. */
export interface IdeaSource {
  next(ws: AutopilotWorkspace): Promise<Idea | null>;
  finish(idea: Idea, result: { status: "done" | "failed" | "queued"; error?: string }): Promise<void>;
}

export interface AutopilotDeps {
  now(): Date;
  /** Problems that stop publishing right now (missing keys, Pinterest not connected…). Empty = ready. */
  readinessProblems(ws: AutopilotWorkspace): Promise<string[]>;
  /** Local hours (0–23) when posting is allowed, or null for any time. */
  postingHours(ws: AutopilotWorkspace): Promise<number[] | null>;
  /** Autopilot publish attempts started since `since`, and when the latest one started. */
  recentPublishes(ws: AutopilotWorkspace, since: Date): Promise<{ count: number; lastAt: Date | null }>;
  /** Oldest autopilot pin that's approved, has a real image and isn't published. */
  nextReadyDraft(ws: AutopilotWorkspace): Promise<{ id: string } | null>;
  ideas: IdeaSource;
  /** Writes 5 pins (text + images) for an idea and saves them as auto-approved. Returns how many got an image. */
  createPins(ws: AutopilotWorkspace, idea: Idea): Promise<number>;
  publish(ws: AutopilotWorkspace, draftId: string): Promise<{ ok: boolean; pinId?: string; error?: string }>;
  setState(ws: AutopilotWorkspace, state: { paused_reason: string | null }): Promise<void>;
  isBudgetError(err: unknown): boolean;
}

export type AutopilotOutcome =
  | { action: "blocked"; detail: string }
  | { action: "daily_limit"; detail: string }
  | { action: "waiting"; detail: string; nextAt: string }
  | { action: "idle"; detail: string }
  | { action: "published"; detail: string; pinId?: string; draftId: string }
  | { action: "failed"; detail: string };

/** Minimum gap between pins so the day's posts are spread across the allowed hours. */
export function spacingMs(pinsPerDay: number, activeHours = 24): number {
  const span = Math.max(1, Math.min(24, activeHours)) * 3_600_000;
  return Math.floor((span / Math.max(1, Math.min(MAX_PINS_PER_DAY, pinsPerDay))) * 0.9);
}

/** The next moment (on the hour) that falls inside `hours`, in the given timezone. */
export function nextAllowedAt(now: Date, hours: number[], timeZone: string): Date {
  for (let i = 1; i <= 24; i++) {
    const t = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + i * 3_600_000);
    if (hours.includes(localHour(t, timeZone))) return t;
  }
  return new Date(now.getTime() + DAY_MS);
}

export async function runAutopilotStep(ws: AutopilotWorkspace, deps: AutopilotDeps): Promise<AutopilotOutcome> {
  const problems = await deps.readinessProblems(ws);
  if (problems.length) {
    const detail = problems.join(" ");
    await deps.setState(ws, { paused_reason: detail });
    return { action: "blocked", detail };
  }

  const now = deps.now();
  const recent = await deps.recentPublishes(ws, new Date(now.getTime() - DAY_MS));
  if (recent.count >= ws.pins_per_day) {
    await deps.setState(ws, { paused_reason: null });
    return { action: "daily_limit", detail: `Daily limit reached (${recent.count}/${ws.pins_per_day} in the last 24 hours).` };
  }
  const hours = ws.best_time ? await deps.postingHours(ws) : null;
  if (hours?.length && !hours.includes(localHour(now, ws.timezone))) {
    await deps.setState(ws, { paused_reason: null });
    return { action: "waiting", detail: "Waiting for your best posting hours.", nextAt: nextAllowedAt(now, hours, ws.timezone).toISOString() };
  }
  if (recent.lastAt) {
    const nextAt = recent.lastAt.getTime() + spacingMs(ws.pins_per_day, hours?.length || 24);
    if (now.getTime() < nextAt) {
      await deps.setState(ws, { paused_reason: null });
      return { action: "waiting", detail: "Spacing out today's pins.", nextAt: new Date(nextAt).toISOString() };
    }
  }

  let draft = await deps.nextReadyDraft(ws);
  if (!draft) {
    const idea = await deps.ideas.next(ws);
    if (!idea) {
      await deps.setState(ws, { paused_reason: "The idea queue is empty. Add titles or ideas to keep posting." });
      return { action: "idle", detail: "No ready pins and no queued ideas." };
    }
    try {
      const made = await deps.createPins(ws, idea);
      await deps.ideas.finish(idea, made > 0 ? { status: "done" } : { status: "failed", error: "No pin got an image." });
    } catch (err) {
      const msg = (err as Error).message;
      if (deps.isBudgetError(err)) {
        await deps.ideas.finish(idea, { status: "queued" });
        await deps.setState(ws, { paused_reason: msg });
        return { action: "blocked", detail: msg };
      }
      await deps.ideas.finish(idea, { status: "failed", error: msg });
      await deps.setState(ws, { paused_reason: `Last idea failed: ${msg}` });
      return { action: "failed", detail: msg };
    }
    draft = await deps.nextReadyDraft(ws);
    if (!draft) return { action: "failed", detail: "Pins were written but none has a publishable image." };
  }

  const res = await deps.publish(ws, draft.id);
  if (!res.ok) {
    await deps.setState(ws, { paused_reason: `Last publish failed: ${res.error ?? "unknown error"}` });
    return { action: "failed", detail: res.error ?? "Publishing failed" };
  }
  await deps.setState(ws, { paused_reason: null });
  return { action: "published", detail: "Published one pin.", pinId: res.pinId, draftId: draft.id };
}
