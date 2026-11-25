"use client";
import { useEffect, useState } from "react";

interface Status {
  storage: "supabase" | "demo";
  text: { source: "demo" | "ai"; provider: string };
  image: { source: "demo" | "ai" | "error"; provider: string };
  pinterest: { configured: boolean; env: "sandbox" | "production" };
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
    <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="Integration status">
      {s.storage === "supabase" ? <Pill tone="ok">Storage: Supabase</Pill> : <Pill tone="demo">Storage: Demo (this browser only)</Pill>}
      {s.text.source === "ai" ? <Pill tone="ok">Text AI: {s.text.provider}</Pill> : <Pill tone="demo">Text AI: Demo templates</Pill>}
      {s.image.source === "ai" ? (
        <Pill tone="ok">Image AI: {s.image.provider}</Pill>
      ) : s.image.source === "demo" ? (
        <Pill tone="demo">Image AI: Demo placeholders</Pill>
      ) : (
        <Pill tone="off">Image AI: {s.image.provider}</Pill>
      )}
      {s.pinterest.configured ? (
        <Pill tone="ok">Pinterest app: {s.pinterest.env === "sandbox" ? "Sandbox" : "Production"}</Pill>
      ) : (
        <Pill tone="off">Pinterest: not configured</Pill>
      )}
    </div>
  );
}

/** Compact status for the sidebar: short words and a dot; the model name is in the tooltip. */
export function StatusSummary({ dark = false }: { dark?: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => {});
  }, []);
  if (!s) return null;
  const rows: { label: string; value: string; tone: "ok" | "demo" | "off"; title?: string }[] = [
    { label: "Storage", value: s.storage === "supabase" ? "Cloud" : "Demo", tone: s.storage === "supabase" ? "ok" : "demo", title: s.storage === "supabase" ? "Supabase" : "Saved in this browser only" },
    { label: "Text AI", value: s.text.source === "ai" ? "Live" : "Demo", tone: s.text.source === "ai" ? "ok" : "demo", title: s.text.provider },
    { label: "Image AI", value: s.image.source === "ai" ? "Live" : s.image.source === "demo" ? "Demo" : "Off", tone: s.image.source === "ai" ? "ok" : s.image.source === "demo" ? "demo" : "off", title: s.image.provider },
    { label: "Pinterest", value: s.pinterest.configured ? (s.pinterest.env === "sandbox" ? "Sandbox" : "Ready") : "Not set", tone: s.pinterest.configured ? "ok" : "off" },
  ];
  const dot = { ok: "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400", demo: "bg-amber-400 shadow-[0_0_6px] shadow-amber-400", off: "bg-zinc-400" };
  return (
    <ul className={`flex flex-col gap-1.5 text-xs ${dark ? "" : "px-3"}`} aria-label="Integration status">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-1.5" title={r.title}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[r.tone]}`} aria-hidden />
          <span className={dark ? "text-white/50" : "text-zinc-500"}>{r.label}</span>
          <span className={`ml-auto font-medium ${dark ? "text-white/85" : "text-zinc-800"}`}>{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
