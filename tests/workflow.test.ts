import { describe, expect, it, vi } from "vitest";
import { PinterestApiError } from "@/lib/pinterest/api";
import { getPinterestConfig } from "@/lib/pinterest/config";
import { publishBlockers, validateRunAt } from "@/lib/workflow/checks";
import { findExistingPin, runPublishJob, type DraftForPublish, type PublishJob, type RunnerDeps } from "@/lib/workflow/runner";
import { availableActions, nextStatus } from "@/lib/workflow/transitions";

describe("transitions", () => {
  it("follows Draft → In review → Approved → Scheduled", () => {
    expect(nextStatus("draft", "submit")).toBe("in_review");
    expect(nextStatus("in_review", "approve")).toBe("approved");
    expect(nextStatus("approved", "schedule")).toBe("scheduled");
    expect(nextStatus("scheduled", "cancel_schedule")).toBe("approved");
    expect(nextStatus("in_review", "request_changes")).toBe("draft");
  });
  it("refuses to skip approval or touch published pins", () => {
    expect(() => nextStatus("draft", "approve")).toThrow();
    expect(() => nextStatus("draft", "publish_now")).toThrow();
    expect(() => nextStatus("in_review", "publish_now")).toThrow();
    expect(() => nextStatus("published", "publish_now")).toThrow();
    expect(availableActions("published")).toEqual([]);
  });
});

const approved = {
  status: "approved" as const, title: "T", description: "D", alt_text: "A", image_status: "ready" as const,
  image_path: "ws/d-1.png", image_source: "ai" as const, link: null, external_pin_id: null,
};
const okCtx = { connected: true, connectionActive: true, grantedScopes: ["boards:read", "boards:write", "pins:read", "pins:write"], boardId: "b1" };

describe("publish blockers", () => {
  it("passes a complete approved pin", () => {
    expect(publishBlockers(approved, okCtx)).toEqual([]);
  });
  it("blocks demo images, SVGs, missing board/scopes, bad links and repeats", () => {
    expect(publishBlockers({ ...approved, image_source: "demo" }, okCtx).join()).toMatch(/DEMO/);
    expect(publishBlockers({ ...approved, image_path: "ws/x.svg" }, okCtx).join()).toMatch(/PNG or JPEG/);
    expect(publishBlockers(approved, { ...okCtx, boardId: null }).join()).toMatch(/board/);
    expect(publishBlockers(approved, { ...okCtx, grantedScopes: ["pins:read"] }).join()).toMatch(/pins:write/);
    expect(publishBlockers({ ...approved, link: "javascript:alert(1)" }, okCtx).join()).toMatch(/http/);
    expect(publishBlockers({ ...approved, external_pin_id: "123" }, okCtx).join()).toMatch(/already published/);
    expect(publishBlockers({ ...approved, status: "in_review" }, okCtx).join()).toMatch(/approved first/);
  });
  it("validates schedule time", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    expect(validateRunAt("2026-11-25T10:02:00Z", now)).toMatch(/5 minutes/);
    expect(validateRunAt("2026-11-25T12:00:00Z", now)).toBeNull();
    expect(validateRunAt("nope", now)).toMatch(/valid/);
  });
});

describe("publishing scopes", () => {
  const ENV = { PINTEREST_CLIENT_ID: "a", PINTEREST_CLIENT_SECRET: "b", PINTEREST_REDIRECT_URI: "c", TOKEN_ENCRYPTION_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "s" };
  it("requests write scopes only when publishing is enabled", () => {
    expect(getPinterestConfig(ENV).scopes).not.toContain("pins:write");
    expect(getPinterestConfig({ ...ENV, PINTEREST_ENABLE_PUBLISHING: "true" }).scopes).toEqual(expect.arrayContaining(["pins:write", "boards:write"]));
  });
});

// ---- runner ---------------------------------------------------------------
function harness(over: Partial<RunnerDeps> = {}, jobOver: Partial<PublishJob> = {}, draftOver: Partial<DraftForPublish> = {}) {
  const job: PublishJob = { id: "j1", workspace_id: "w", draft_id: "d", board_id: "b1", attempts: 1, max_attempts: 3, uncertain: false, started_at: "2026-11-25T10:00:00Z", ...jobOver };
  const draft: DraftForPublish = { title: "Trench coat", description: "Desc", alt_text: "Alt", link: null, image_path: "w/d.png", status: "scheduled", external_pin_id: null, ...draftOver };
  const deps: RunnerDeps = {
    claim: vi.fn().mockResolvedValue(job),
    getDraft: vi.fn().mockResolvedValue(draft),
    getAccessToken: vi.fn().mockResolvedValue("tok"),
    loadImage: vi.fn().mockResolvedValue({ base64: "AAA", contentType: "image/png" }),
    createPin: vi.fn().mockResolvedValue({ id: "pin-1" }),
    recentBoardPins: vi.fn().mockResolvedValue([]),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { deps, job, draft };
}

describe("publish runner", () => {
  it("creates the pin once and records its ID", async () => {
    const { deps } = harness();
    expect(await runPublishJob("j1", deps)).toEqual({ status: "succeeded", pinId: "pin-1", recovered: false });
    expect(deps.createPin).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.createPin).mock.calls[0][1]).toMatchObject({ board_id: "b1", title: "Trench coat", media_source: { source_type: "image_base64", content_type: "image/png" } });
    expect(deps.succeed).toHaveBeenCalledWith(expect.anything(), "pin-1", false);
  });
  it("does nothing if another runner already claimed the job", async () => {
    const { deps } = harness({ claim: vi.fn().mockResolvedValue(null) });
    expect(await runPublishJob("j1", deps)).toEqual({ status: "skipped" });
    expect(deps.createPin).not.toHaveBeenCalled();
  });
  it("never republishes a draft that already has a pin ID", async () => {
    const { deps } = harness({}, {}, { external_pin_id: "pin-old" });
    expect(await runPublishJob("j1", deps)).toMatchObject({ status: "succeeded", pinId: "pin-old", recovered: true });
    expect(deps.createPin).not.toHaveBeenCalled();
  });
  it("refuses drafts that are no longer scheduled (e.g. edited or cancelled)", async () => {
    const { deps } = harness({}, {}, { status: "approved" });
    expect((await runPublishJob("j1", deps)).status).toBe("failed");
    expect(deps.createPin).not.toHaveBeenCalled();
  });
  it("after an uncertain failure, finds the existing pin instead of creating a duplicate", async () => {
    const { deps } = harness(
      { recentBoardPins: vi.fn().mockResolvedValue([{ id: "pin-x", title: "Trench coat", description: "Desc", created_at: "2026-11-25T10:00:05Z" }]) },
      { uncertain: true, attempts: 2 },
    );
    expect(await runPublishJob("j1", deps)).toEqual({ status: "succeeded", pinId: "pin-x", recovered: true });
    expect(deps.createPin).not.toHaveBeenCalled();
  });
  it("marks timeouts as uncertain and retries with backoff", async () => {
    const { deps } = harness({ createPin: vi.fn().mockRejectedValue(new Error("socket hang up")) });
    expect((await runPublishJob("j1", deps, () => 0)).status).toBe("retrying");
    expect(deps.fail).toHaveBeenCalledWith(expect.anything(), "socket hang up", { retry: true, uncertain: true, retryAt: new Date(60_000).toISOString() });
  });
  it("uses Pinterest's retry-after for rate limits and stops at max attempts", async () => {
    const rl = new PinterestApiError("slow down", 429, 8, 120);
    const a = harness({ createPin: vi.fn().mockRejectedValue(rl) });
    await runPublishJob("j1", a.deps, () => 0);
    expect(vi.mocked(a.deps.fail).mock.calls[0][2]).toMatchObject({ retry: true, uncertain: false, retryAt: new Date(120_000).toISOString() });

    const b = harness({ createPin: vi.fn().mockRejectedValue(rl) }, { attempts: 3 });
    expect((await runPublishJob("j1", b.deps)).status).toBe("failed");
  });
  it("does not retry client errors like a bad board", async () => {
    const { deps } = harness({ createPin: vi.fn().mockRejectedValue(new PinterestApiError("Board not found", 404)) });
    expect((await runPublishJob("j1", deps)).status).toBe("failed");
    expect(vi.mocked(deps.fail).mock.calls[0][2].retry).toBe(false);
  });
  it("matches existing pins by title, description and time", () => {
    const d = { title: "A", description: "B" } as DraftForPublish;
    expect(findExistingPin([{ id: "1", title: "a ", description: "b", created_at: "2026-01-01T00:00:00Z" }], d, "2026-01-01T00:00:30Z")?.id).toBe("1");
    expect(findExistingPin([{ id: "1", title: "A", description: "B", created_at: "2025-01-01T00:00:00Z" }], d, "2026-01-01T00:00:00Z")).toBeNull();
    expect(findExistingPin([{ id: "1", title: "A", description: "other" }], d, null)).toBeNull();
  });
});
