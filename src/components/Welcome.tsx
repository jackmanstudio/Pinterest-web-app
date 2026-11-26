"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getStore } from "@/lib/store";

interface Step {
  title: string;
  detail: string;
  href: string;
  done: boolean;
}

/** First-run checklist after sign-up (spec 12 user journey). Status is read from your real data. */
export function Welcome() {
  const router = useRouter();
  const [name, setName] = useState<string>("");
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = getStore();
      const profile = store.mode === "supabase" ? await fetch("/api/auth/profile").then((r) => r.json()).catch(() => ({})) : {};
      let brand = false, drafts = 0, plans = 0, connected = false, scheduled = 0;
      const list = await store.listWorkspaces().catch(() => []);
      const first = list[0]?.kind ?? null;
      /** No account yet: each step starts by adding one. */
      const at = (sub: string) => (first ? `/w/${first}${sub}` : "/overview?add=1");
      for (const ws of list) {
        const k = ws.kind;
        try {
          const [b, d, p] = await Promise.all([store.getBrand(ws.id), store.listDrafts(ws.id), store.listBoardPlans(ws.id)]);
          brand ||= Boolean(b.brand_name?.trim() || b.website_url?.trim());
          drafts += d.length;
          plans += p.length;
          scheduled += d.filter((x) => x.status === "scheduled" || x.status === "published").length;
          const s = await fetch(`/api/pinterest/status?workspace=${k}`).then((r) => r.json()).catch(() => ({}));
          connected ||= s.connection?.status === "active";
        } catch {
          /* keep going: show what we can */
        }
      }
      if (cancelled) return;
      setName(typeof profile.full_name === "string" ? profile.full_name.split(" ")[0] : "");
      setSteps([
        { title: "Add a Pinterest account", detail: "Name it after your Pinterest profile or niche. You can add as many as you run.", href: "/overview?add=1", done: list.length > 0 },
        { title: "Set up your brand", detail: "Name, website, voice and pin design, so every pin looks like you.", href: at("/settings"), done: brand },
        { title: "Connect Pinterest", detail: "Link your account so we can read your boards. Nothing is posted without your OK.", href: at("/pinterest"), done: connected },
        { title: "Make your first pins", detail: "Type a keyword and get finished, designed pins.", href: at(""), done: drafts > 0 },
        { title: "Organise boards", detail: "Let AI pick the right board for each pin, or set your own rules.", href: at("/boards"), done: plans > 0 },
        { title: "Review & schedule", detail: "Approve pins and schedule them, or turn on Autopilot later.", href: at("/publish"), done: scheduled > 0 },
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finish() {
    if (getStore().mode === "supabase") await fetch("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarded: true }) }).catch(() => {});
    router.push("/overview");
  }

  const done = steps?.filter((s) => s.done).length ?? 0;
  return (
    <div className="mx-auto max-w-2xl py-4">
      <h1 className="text-3xl text-[#2a1416]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
        Welcome{name ? `, ${name}` : ""}.
      </h1>
      <p className="mt-2 text-zinc-600">Six steps to your first scheduled pins. You can come back to this list any time from Account.</p>
      {!steps ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
            <div className="h-full rounded-full bg-[#2a1416] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-zinc-600">{done} of {steps.length} done</p>
          <ol className="mt-5 flex flex-col gap-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex items-start gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold ${s.done ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-700"}`} aria-hidden>
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.title}{s.done && <span className="sr-only"> (done)</span>}</p>
                  <p className="text-sm text-zinc-600">{s.detail}</p>
                </div>
                <Link href={s.href} className="self-center whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50">
                  {s.done ? "Open" : "Start"}
                </Link>
              </li>
            ))}
          </ol>
          <button onClick={finish} className="mt-6 rounded-lg bg-[#2a1416] px-4 py-2.5 font-medium text-white hover:bg-[#3d1d20]">Go to my dashboard</button>
        </>
      )}
    </div>
  );
}
