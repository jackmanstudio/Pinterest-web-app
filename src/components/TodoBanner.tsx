"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "./NavLink";
import type { TodoKey } from "@/lib/account/health";

/** What each "What to do next" item asks for, shown on the page it opens. */
const TODOS: Record<TodoKey, { title: string; steps: string; focus?: string }> = {
  brand: { title: "Fill in your brand", steps: "Add a Brand name and Target audience below, then press Save. Every new pin is written for these people.", focus: "brand_name" },
  "first-pins": { title: "Make your first pins", steps: "Type an idea in the Studio form below and press the create button. Pins land in your Pin library as drafts.", focus: "idea" },
  review: { title: "Review waiting pins", steps: "Check each pin below, then Approve it or send it back. Nothing goes live without your approval." },
  "schedule-approved": { title: "Schedule approved pins", steps: "Your approved pins are below. Pick a date and time for each so they post on a regular rhythm." },
  schedule: { title: "Plan the next 7 days", steps: "Nothing is scheduled this week. Open a draft from the calendar, or approve pins in Review & publish and give them a date." },
  "no-image": { title: "Add images", steps: "Some unpublished pins have no image yet. Open each pin below and make or upload its image." },
  "low-quality": { title: "Improve low-scoring pins", steps: "Some pins score below 65 on the quality check. Open each one below to see what to fix in the title, description or tags." },
  duplicates: { title: "Tidy similar pins", steps: "Some pins look almost the same. Change the angle of one, or archive it." },
  "no-link": { title: "Add destination links", steps: "Some unpublished pins have no link. Open each pin below and add the page people should land on." },
  stale: { title: "Publish again", steps: "Nothing was published in the last 14 days. Approve and schedule a few pins to keep the account active." },
};

function isTodo(v: string | null): v is TodoKey {
  return v !== null && v in TODOS;
}

/** A callout at the top of a workspace page opened from a "What to do next" item (?todo=…). */
export function TodoBanner() {
  const path = usePathname();
  const [todo, setTodo] = useState<TodoKey | null>(null);

  useEffect(() => {
    // Read the address after load so the page itself stays static.
    const t = new URLSearchParams(window.location.search).get("todo");
    const next = isTodo(t) ? t : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable in the browser
    setTodo(next);
    const id = next && TODOS[next].focus;
    if (!id) return;
    // The form loads its data first, so wait (up to ~4s) for the field to appear.
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 20) window.clearInterval(timer);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [path]);

  if (!todo) return null;
  const t = TODOS[todo];
  return (
    <div role="status" className="au-glass mb-5 flex flex-col gap-3 rounded-2xl border-amber-300/30 p-4 sm:flex-row sm:items-center">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#e60023] to-[#ff7a45] text-sm font-bold text-white">✓</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-white">To-do: {t.title}</p>
        <p className="mt-0.5 text-[13px] text-white/70">{t.steps}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link href="/overview" className="rounded-xl bg-white/[0.07] px-3.5 py-1.5 text-[13px] font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/[0.12]">All accounts</Link>
        <button onClick={() => setTodo(null)} className="rounded-xl bg-[#fff] px-3.5 py-1.5 text-[13px] font-bold text-[#0b0912]">Got it</button>
      </div>
    </div>
  );
}
