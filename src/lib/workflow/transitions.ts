import type { DraftStatus } from "@/lib/types";

export type WorkflowAction = "submit" | "request_changes" | "approve" | "unapprove" | "schedule" | "cancel_schedule" | "publish_now";

/** The only allowed moves. Anything else is rejected. */
export const TRANSITIONS: Record<WorkflowAction, { from: DraftStatus[]; to: DraftStatus }> = {
  submit: { from: ["draft"], to: "in_review" },
  request_changes: { from: ["in_review"], to: "draft" },
  approve: { from: ["in_review"], to: "approved" },
  unapprove: { from: ["approved"], to: "draft" },
  schedule: { from: ["approved"], to: "scheduled" },
  cancel_schedule: { from: ["scheduled"], to: "approved" },
  // Publishing goes through a job: approved -> scheduled (run now) -> published.
  publish_now: { from: ["approved"], to: "scheduled" },
};

export const ACTION_LABELS: Record<WorkflowAction, string> = {
  submit: "Submit for review",
  request_changes: "Request changes",
  approve: "Approve",
  unapprove: "Withdraw approval",
  schedule: "Schedule",
  cancel_schedule: "Cancel schedule",
  publish_now: "Publish now",
};

/** Actions that touch live Pinterest content and need a second, explicit confirmation. */
export const LIVE_ACTIONS: WorkflowAction[] = ["schedule", "publish_now"];

export function nextStatus(current: DraftStatus, action: WorkflowAction): DraftStatus {
  const t = TRANSITIONS[action];
  if (!t || !t.from.includes(current)) {
    throw new Error(`Can't "${ACTION_LABELS[action] ?? action}" a pin that is ${current.replace("_", " ")}.`);
  }
  return t.to;
}

export function availableActions(current: DraftStatus): WorkflowAction[] {
  return (Object.keys(TRANSITIONS) as WorkflowAction[]).filter((a) => TRANSITIONS[a].from.includes(current));
}
