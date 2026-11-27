"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import { FONT_LABELS, STYLE_LABELS, TEMPLATE_FONTS, TEMPLATE_STYLES, layoutFor, overlaySvg, readTemplate, type PinTemplate } from "@/lib/brand/template";
import { PALETTE_LABELS, PALETTES } from "@/lib/brand/design";

/** Sample pins for the Designer-mix preview: one per creative angle. */
const SAMPLES: { angle: string; title: string; bg: string }[] = [
  { angle: "How-to / tutorial", title: "Layering a Trench Coat: A Simple 4-Step Guide", bg: "from-stone-300 via-stone-500 to-stone-700" },
  { angle: "List / roundup", title: "7 Autumn Outfits in Camel and Cream", bg: "from-emerald-900 via-stone-500 to-stone-300" },
  { angle: "Inspiration / mood", title: "Soft Neutrals for Slow Weekends", bg: "from-rose-200 via-rose-400 to-stone-700" },
  { angle: "Problem → solution", title: "No More Boring Workwear: Easy Upgrades", bg: "from-stone-200 via-stone-600 to-zinc-900" },
  { angle: "Seasonal / timely", title: "Cosy Winter Layers You Will Love", bg: "from-slate-400 via-slate-700 to-slate-900" },
];
import type { BrandSettings } from "@/lib/types";

interface Props {
  store: Store;
  workspaceId: string;
  brand: BrandSettings;
  sampleTitle: string;
  onSaved: (b: BrandSettings) => void;
}

const MAX_LOGO = 300_000;

/** Per-workspace pin design with a live preview drawn by the same code the server uses. */
export function PinDesign({ store, workspaceId, brand, sampleTitle, onSaved }: Props) {
  const [t, setT] = useState<PinTemplate>(() => readTemplate(brand.pin_template));
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    store.logoUrl(t.logo).then((u) => !off && setLogoUrl(u)).catch(() => {});
    return () => {
      off = true;
    };
  }, [store, t.logo]);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return setMsg({ text: "Logo must be a PNG or JPEG.", ok: false });
    if (file.size > MAX_LOGO) return setMsg({ text: "Logo must be under 300 KB.", ok: false });
    setBusy(true);
    try {
      setT({ ...t, logo: await store.uploadLogo(workspaceId, file) });
      setMsg(null);
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const next = { ...brand, pin_template: t };
      await store.saveBrand(workspaceId, next);
      onSaved(next);
      setMsg({ text: "Pin design saved. New images will use it.", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  const mix = t.style === "auto";
  return (
    <section className="au-glass flex min-w-0 flex-col gap-6 rounded-2xl p-5 sm:p-6 md:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Pin design</h2>
          <p className="text-sm text-white/60">Every new pin image gets the title written on it in this style, with your colours, handle and logo.</p>
        </div>
      </div>

      {/* 1. Layout style: visual cards instead of a long select */}
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">Layout style</legend>
        <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-6 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-11">
          {TEMPLATE_STYLES.map((s, i) => {
            const active = t.style === s;
            const sample = SAMPLES[i % SAMPLES.length];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setT({ ...t, style: s })}
                aria-pressed={active}
                title={STYLE_LABELS[s]}
                className={`group flex w-[5.5rem] shrink-0 snap-start flex-col gap-1.5 rounded-xl p-1.5 text-left transition sm:w-auto ${active ? "bg-white/[0.1] ring-2 ring-[#ff7a45]" : "ring-1 ring-white/10 hover:bg-white/[0.06] hover:ring-white/25"}`}
              >
                <span className={`relative block aspect-[2/3] overflow-hidden rounded-lg bg-gradient-to-b ${sample.bg}`}>
                  <span
                    className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: overlaySvg({ width: 400, height: 600, title: s === "none" ? "" : sample.title, template: { ...t, style: s }, logoHref: logoUrl, angle: sample.angle }) }}
                  />
                  {s === "auto" && <span className="absolute left-1 top-1 rounded-full bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">Best</span>}
                  {active && (
                    <span aria-hidden className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[#ff7a45] text-[11px] font-bold text-white">✓</span>
                  )}
                </span>
                <span className={`px-0.5 text-[12px] font-semibold leading-tight ${active ? "text-white" : "text-white/70"}`}>{SHORT_STYLE[s]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-white/50">{STYLE_LABELS[t.style]}</p>
      </fieldset>

      <div className="grid gap-6 border-t border-white/10 pt-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* 2. Live preview */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">Preview</span>
          {mix ? (
            <div className="grid grid-cols-5 gap-2" aria-label="Designer mix preview: five layouts">
              {SAMPLES.map((p) => (
                <figure key={p.angle} className="flex flex-col gap-1">
                  <div className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-gradient-to-b ${p.bg}`}>
                    <div
                      className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: overlaySvg({ width: 400, height: 600, title: p.title, template: t, logoHref: logoUrl, angle: p.angle }) }}
                    />
                  </div>
                  <figcaption className="truncate text-center text-[10.5px] capitalize text-white/50">{layoutFor(t, p.angle, p.title)}</figcaption>
                </figure>
              ))}
              <p className="col-span-5 mt-1 text-xs text-white/50">Designer mix gives each pin of a batch its own layout, so your board never looks repetitive.</p>
            </div>
          ) : (
            <div className="relative mx-auto aspect-[2/3] w-full max-w-[280px] overflow-hidden rounded-xl bg-gradient-to-br from-stone-400 via-amber-700 to-stone-800 ring-1 ring-white/10 lg:mx-0" aria-label="Pin design preview">
              <div className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: overlaySvg({ width: 400, height: 600, title: sampleTitle, template: t, logoHref: logoUrl }) }} />
            </div>
          )}
        </div>

        {/* 3. Settings */}
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label="Colour palette">
              <span className="relative flex items-center">
                <select className="au-field h-11 w-full appearance-none truncate pl-4 pr-10 text-sm font-medium" value={t.palette} onChange={(e) => setT({ ...t, palette: e.target.value as PinTemplate["palette"] })}>
                  {PALETTES.map((p) => (
                    <option key={p} value={p}>{PALETTE_LABELS[p]}</option>
                  ))}
                </select>
                <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-3.5 h-4 w-4 text-white/55" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </span>
            </Row>
            <Row label="Font" hint={mix ? "Designer mix pairs its own serif + sans." : undefined}>
              <div role="radiogroup" aria-label="Font" className={`grid h-11 grid-cols-3 gap-1 rounded-[0.875rem] bg-white/[0.05] p-1 ring-1 ring-white/12 ${mix ? "opacity-45" : ""}`}>
                {TEMPLATE_FONTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={t.font === f}
                    disabled={mix}
                    onClick={() => setT({ ...t, font: f })}
                    className={`truncate rounded-[0.6rem] px-2 text-[13px] font-semibold transition ${t.font === f ? "bg-white/[0.14] text-white shadow" : "text-white/60 hover:text-white"} disabled:cursor-not-allowed`}
                  >
                    <span className="capitalize">{FONT_LABELS[f].split(" ").pop()}</span>
                  </button>
                ))}
              </div>
            </Row>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ColourField label="Brand colour" value={t.primary_color} onChange={(v) => setT({ ...t, primary_color: v })} />
            <ColourField label="Text colour" value={t.text_color} onChange={(v) => setT({ ...t, text_color: v })} />
          </div>

          <Row label="Handle or website shown on the pin">
            <input className="au-field h-11 w-full px-4 text-sm" maxLength={40} placeholder="@yourbrand or yoursite.com" value={t.handle} onChange={(e) => setT({ ...t, handle: e.target.value })} />
          </Row>

          <Row label="Logo">
            <div className="flex items-center gap-3 rounded-[0.875rem] bg-white/[0.04] p-2.5 ring-1 ring-white/10">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {logoUrl && t.logo ? <img src={logoUrl} alt="Your logo" className="h-full w-full object-contain" /> : <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>}
              </span>
              <span className="min-w-0 flex-1 text-xs text-white/55">PNG or JPEG, under 300 KB. A square logo works best.</span>
              {t.logo && (
                <button type="button" onClick={() => setT({ ...t, logo: null })} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#ff6b80] hover:bg-red-500/10">Remove</button>
              )}
              <label className="shrink-0 cursor-pointer rounded-lg bg-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/[0.14]">
                {t.logo ? "Change" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => pickLogo(e.target.files?.[0])} />
              </label>
            </div>
          </Row>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button onClick={save} disabled={busy} className="rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(255,90,60,0.9)] hover:brightness-110 disabled:opacity-50">
              {busy ? "Saving…" : "Save pin design"}
            </button>
            {msg && <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-[#ff8a98]"}`} role="status">{msg.text}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

const SHORT_STYLE: Record<PinTemplate["style"], string> = {
  auto: "Designer mix", paper: "Paper", framed: "Framed", caption: "Caption", editorial: "Editorial", centered: "Centered",
  subtle: "Small caption", minimal: "Minimal", elegant: "Elegant", bold: "Bold band", none: "No text",
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-white/80">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-white/45">{hint}</span>}
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <label className="flex h-11 cursor-pointer items-center gap-3 rounded-[0.875rem] border border-white/12 bg-white/[0.05] pl-1.5 pr-4 transition-colors hover:border-white/28">
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[0.55rem] ring-1 ring-white/25" style={{ background: value }}>
          <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </span>
        <span className="truncate font-mono text-sm uppercase text-white/85">{value}</span>
      </label>
    </Row>
  );
}
