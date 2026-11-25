import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const migrations = readdirSync(path.join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(root, "supabase/migrations", f), "utf8"))
  .join("\n");

describe("tenant isolation guard rails", () => {
  it("every public table has row-level security turned on", () => {
    const tables = [...migrations.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(10);
    const missing = tables.filter((t) => !new RegExp(`alter table public\\.${t} enable row level security`, "i").test(migrations));
    expect(missing).toEqual([]);
  });
  it("server-only job functions are not callable by signed-in users", () => {
    for (const fn of ["claim_publish_job", "recover_stale_publish_jobs"]) {
      expect(migrations).toMatch(new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`));
    }
  });
});

describe("secrets stay on the server", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const client = files(path.join(root, "src")).filter((f) => /\.(tsx?|ts)$/.test(f) && readFileSync(f, "utf8").startsWith('"use client"'));
  it("client code never reads server secrets", () => {
    const bad = client.filter((f) => /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => path.relative(root, f))).toEqual([]);
  });
  it("client code never imports the service-role client or token crypto", () => {
    const bad = client.filter((f) => /^import (?!type )[^\n]*(supabase\/admin|crypto\/tokens|pinterest\/connections)/m.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => path.relative(root, f))).toEqual([]);
  });
});
