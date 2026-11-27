"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MAX_WORKSPACE_NAME, NICHE_LABELS, WORKSPACE_NICHES, type WorkspaceNiche } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { START_PAGES, startPath } from "@/lib/startPages";
import { announceWorkspacesChanged, useWorkspaces } from "./useWorkspaces";

const loadStore = async (): Promise<Store> => (isSupabaseConfigured ? (await import("@/lib/store")).getStore() : (await import("@/lib/store/demo")).getDemoStore());


/**
 * Shown when a user with no account opens an account page from the menu: the page's
 * name and what it does, plus a one-field form that makes the account and opens the page.
 */
export function StartPage({ section }: { section: string }) {
  const page = START_PAGES[section];
  const router = useRouter();
  const { list } = useWorkspaces();
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState<WorkspaceNiche>("macro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already has an account (e.g. added in another tab): open the real page.
  useEffect(() => {
    if (list && list.length > 0) router.replace(`/w/${list[0].kind}${startPath(section)}`);
  }, [list, section, router]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      ref.current?.focus();
      return setErr("Give the account a name, e.g. your Pinterest username or niche.");
    }
    setBusy(true);
    setErr(null);
    try {
      const w = await (await loadStore()).createWorkspace(n, niche);
      announceWorkspacesChanged();
      router.push(`/w/${w.kind}${startPath(section)}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="pt-2 sm:pt-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{page.label}</h1>
        <p className="mt-2 max-w-xl text-[15px] text-white/60">{page.about}</p>
      </section>
      <section className="au-glass relative overflow-hidden rounded-2xl p-5 ring-2 ring-[#ff7a45]/60 sm:p-6" aria-labelledby="start-add">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-[#ff7a45]/20 blur-3xl" />
        <h2 id="start-add" className="relative text-lg font-semibold">First, add your Pinterest account</h2>
        <p className="relative mt-1 max-w-xl text-sm text-white/60">
          {page.label} works per account, so it needs one account to start. Name it below and {page.label} opens straight after. You can add more accounts any time.
        </p>
        <form onSubmit={add} className="relative mt-4 flex max-w-xl flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-white/80">Account name</span>
            <input
              ref={ref}
              autoFocus
              value={name}
              maxLength={MAX_WORKSPACE_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Modest Fashion PK or Easy Recipes"
              className="rounded-xl px-3 py-2.5 text-base"
            />
          </label>
          <fieldset className="flex flex-wrap gap-2 text-sm">
            <legend className="mb-1.5 font-medium text-white/80">Starter categories</legend>
            {WORKSPACE_NICHES.map((v) => (
              <label key={v} className={`cursor-pointer rounded-xl px-3 py-2 ring-1 ${niche === v ? "bg-white/[0.08] ring-[#ff7a45]/70" : "ring-white/15"}`}>
                <input type="radio" name="niche" value={v} checked={niche === v} onChange={() => setNiche(v)} className="mr-2" />
                {NICHE_LABELS[v]}
              </label>
            ))}
          </fieldset>
          {err && <p className="text-sm text-red-300" role="alert">{err}</p>}
          <button disabled={busy} className="self-start rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {busy ? "Adding…" : `Add account and open ${page.label}`}
          </button>
        </form>
      </section>
    </div>
  );
}
