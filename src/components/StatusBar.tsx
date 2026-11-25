"use client";
import { useEffect, useState } from "react";

interface Status {
  storage: "supabase" | "demo";
  text: { source: "demo" | "ai"; provider: string };
  image: { source: "demo" | "ai" | "error"; provider: string };
  pinterest: { status: string };
}

function Pill({ tone, children }: { tone: "ok" | "demo" | "off"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    demo: "bg-amber-50 text-amber-900 ring-amber-300",
    off: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{children}</span>;
}

/** Shows exactly which integrations are real, demo, or not connected. */
export function StatusBar() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setErr(true));
  }, []);
  if (err) return <Pill tone="off">Status unavailable</Pill>;
  if (!s) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Integration status">
      {s.storage === "supabase" ? <Pill tone="ok">Storage: Supabase</Pill> : <Pill tone="demo">Storage: Demo (this browser only)</Pill>}
      {s.text.source === "ai" ? <Pill tone="ok">Text AI: {s.text.provider}</Pill> : <Pill tone="demo">Text AI: Demo templates</Pill>}
      {s.image.source === "ai" ? (
        <Pill tone="ok">Image AI: {s.image.provider}</Pill>
      ) : s.image.source === "demo" ? (
        <Pill tone="demo">Image AI: Demo placeholders</Pill>
      ) : (
        <Pill tone="off">Image AI: {s.image.provider}</Pill>
      )}
      <Pill tone="off">Pinterest: not connected</Pill>
    </div>
  );
}
