import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";

export interface WorkerRun {
  name: string;
  last_run_at: string;
  last_ok: boolean;
  last_result: Record<string, unknown>;
}

/** Heartbeat for a background worker. Never throws: a missing table (migration 0016) just skips it. */
export async function recordWorkerRun(admin: SupabaseClient, name: string, ok: boolean, result: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("worker_runs").upsert({ name, last_run_at: new Date().toISOString(), last_ok: ok, last_result: result });
  if (error) log("warn", "worker_heartbeat_failed", { name, error: error.message });
}

export async function readWorkerRuns(admin: SupabaseClient): Promise<WorkerRun[] | null> {
  const { data, error } = await admin.from("worker_runs").select("name, last_run_at, last_ok, last_result");
  return error ? null : (data as WorkerRun[]);
}

/** A worker that should run every few minutes is "late" when it hasn't run for this long. */
export function workerState(run: WorkerRun | undefined, expectedEveryMin: number, now = Date.now()): "never" | "ok" | "late" | "error" {
  if (!run) return "never";
  if (!run.last_ok) return "error";
  return now - Date.parse(run.last_run_at) > expectedEveryMin * 3 * 60_000 ? "late" : "ok";
}
