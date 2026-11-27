import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, clip, newErrorId, whereFrom } from "@/lib/server/errorInfo";

const root = path.resolve(import.meta.dirname, "..");

describe("error reports", () => {
  it("makes short readable error IDs", () => {
    expect(newErrorId(Date.UTC(2026, 10, 27), () => 0.5)).toMatch(/^ERR-[0-9A-Z]{6}-[A-Z0-9]{4}$/);
    expect(newErrorId()).not.toBe(newErrorId());
  });

  it("points at the app's own code, not node_modules", () => {
    const stack = [
      "Error: boom",
      "    at fetchJson (/var/task/node_modules/undici/index.js:10:5)",
      "    at POST (/var/task/src/app/api/generate/route.ts:42:11)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");
    expect(whereFrom(stack)).toBe("POST (/var/task/src/app/api/generate/route.ts:42:11)");
    expect(whereFrom(null)).toBeNull();
  });

  it("keeps route, status, message and cause, and hides secrets", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'id')", { cause: new Error("db timeout") });
    const r = buildReport(err, { route: "/api/generate", method: "POST", status: 500, context: { workspace: "shop", apiKey: "abc", note: "Bearer abc.def.ghi" } }, "ERR-TEST");
    expect(r).toMatchObject({ id: "ERR-TEST", source: "api", route: "/api/generate", method: "POST", status: 500 });
    expect(r.message).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(r.context).toMatchObject({ workspace: "shop", apiKey: "[redacted]", note: "Bearer [redacted]", cause: "db timeout" });
  });

  it("handles non-Error values and clips long text", () => {
    expect(buildReport("plain failure", {}).message).toBe("plain failure");
    expect(buildReport({ code: 42 }, {}).message).toBe('{"code":42}');
    expect(clip("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("no API route swallows a 500 with console.error any more", () => {
    for (const f of ["generate", "images", "boards/assign", "drafts/transition", "tools/check-url", "analytics/insights", "autopilot"]) {
      const src = readFileSync(path.join(root, "src/app/api", f, "route.ts"), "utf8");
      expect(src, f).not.toMatch(/console\.error/);
      expect(src, f).toMatch(/errorResponse\(/);
    }
  });

  it("the error table has row-level security for own rows only", () => {
    const sql = readFileSync(path.join(root, "supabase/migrations/0015_error_events.sql"), "utf8");
    expect(sql).toMatch(/alter table public\.error_events enable row level security/);
    expect(sql).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/with check \(user_id = auth\.uid\(\)\)/);
  });
});
