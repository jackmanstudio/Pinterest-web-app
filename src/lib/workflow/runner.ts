import { PinterestApiError, type CreatePinBody, type PinterestPin } from "@/lib/pinterest/api";

export interface PublishJob {
  id: string;
  workspace_id: string;
  draft_id: string;
  board_id: string;
  attempts: number;
  max_attempts: number;
  uncertain: boolean;
  started_at: string | null;
}

export interface DraftForPublish {
  title: string;
  description: string;
  alt_text: string;
  link: string | null;
  image_path: string;
  status: string;
  external_pin_id: string | null;
}

export interface RunnerDeps {
  /** Atomically flips queued -> running; returns null if someone else took it. */
  claim(jobId: string): Promise<PublishJob | null>;
  getDraft(job: PublishJob): Promise<DraftForPublish>;
  getAccessToken(job: PublishJob): Promise<string>;
  loadImage(path: string): Promise<{ base64: string; contentType: "image/png" | "image/jpeg" }>;
  createPin(token: string, body: CreatePinBody): Promise<PinterestPin>;
  /** Recent pins on the board, newest first (first page only). */
  recentBoardPins(token: string, boardId: string): Promise<PinterestPin[]>;
  succeed(job: PublishJob, pinId: string, viaRecovery: boolean): Promise<void>;
  /** retry=true puts the job back in the queue; false fails it for good. */
  fail(job: PublishJob, error: string, opts: { retry: boolean; uncertain: boolean; retryAt?: string }): Promise<void>;
}

export type RunOutcome =
  | { status: "succeeded"; pinId: string; recovered: boolean }
  | { status: "retrying"; error: string }
  | { status: "failed"; error: string }
  | { status: "skipped" };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Did an earlier, uncertain attempt actually create this pin? */
export function findExistingPin(pins: PinterestPin[], draft: DraftForPublish, since: string | null): PinterestPin | null {
  const sinceMs = since ? Date.parse(since) - 60_000 : 0;
  return (
    pins.find(
      (p) =>
        norm(p.title) === norm(draft.title) &&
        norm(p.description) === norm(draft.description) &&
        (!p.created_at || Date.parse(p.created_at) >= sinceMs),
    ) ?? null
  );
}

/** Errors where Pinterest may or may not have created the pin. */
function isUncertain(err: unknown): boolean {
  if (err instanceof PinterestApiError) return err.status >= 500 || err.status === 408;
  return true; // network error / timeout: the request may have landed
}

function isRetryable(err: unknown): boolean {
  if (err instanceof PinterestApiError) return err.status === 429 || err.status >= 500 || err.status === 408;
  return true;
}

/**
 * Publishes one approved job. Guarantees:
 *  - only one runner can hold a job (atomic claim)
 *  - a draft that already has an external pin id is never published again
 *  - after an uncertain failure, Pinterest is checked for the pin before retrying
 *  - retries are capped by max_attempts
 */
export async function runPublishJob(jobId: string, deps: RunnerDeps, now = () => Date.now()): Promise<RunOutcome> {
  const job = await deps.claim(jobId);
  if (!job) return { status: "skipped" };

  try {
    const draft = await deps.getDraft(job);
    if (draft.external_pin_id) {
      await deps.succeed(job, draft.external_pin_id, true);
      return { status: "succeeded", pinId: draft.external_pin_id, recovered: true };
    }
    if (draft.status !== "scheduled") {
      await deps.fail(job, `Draft is ${draft.status}, not scheduled; not publishing.`, { retry: false, uncertain: false });
      return { status: "failed", error: "Draft is no longer approved for publishing." };
    }

    const token = await deps.getAccessToken(job);

    if (job.uncertain) {
      const existing = findExistingPin(await deps.recentBoardPins(token, job.board_id), draft, job.started_at);
      if (existing) {
        await deps.succeed(job, existing.id, true);
        return { status: "succeeded", pinId: existing.id, recovered: true };
      }
    }

    const image = await deps.loadImage(draft.image_path);
    const body: CreatePinBody = {
      board_id: job.board_id,
      title: draft.title,
      description: draft.description,
      alt_text: draft.alt_text || undefined,
      link: draft.link || undefined,
      media_source: { source_type: "image_base64", content_type: image.contentType, data: image.base64 },
    };
    const pin = await deps.createPin(token, body);
    await deps.succeed(job, pin.id, false);
    return { status: "succeeded", pinId: pin.id, recovered: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const attemptsUsed = job.attempts; // claim() already incremented
    const retry = isRetryable(err) && attemptsUsed < job.max_attempts;
    const waitSec = err instanceof PinterestApiError && err.retryAfterSec ? err.retryAfterSec : 60 * 2 ** (attemptsUsed - 1);
    await deps.fail(job, message, { retry, uncertain: isUncertain(err), retryAt: new Date(now() + waitSec * 1000).toISOString() });
    return retry ? { status: "retrying", error: message } : { status: "failed", error: message };
  }
}
