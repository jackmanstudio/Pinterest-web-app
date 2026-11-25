"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import { FONT_LABELS, STYLE_LABELS, TEMPLATE_FONTS, TEMPLATE_STYLES, layoutFor, overlaySvg, readTemplate, type PinTemplate } from "@/lib/brand/template";
import { PALETTE_LABELS, PALETTES } from "@/lib/brand/design";

/** Sample pins for the Designer-mix preview: one per creative angle. */
const SAMPLES: { angle: string; title: string; bg: string }[] = [
  { angle: "How-to / tutorial", title: "Layering a Trench Coat: A Simple 4-Step Guide", bg: "from-stone-300 via-stone-500 to-stone-700" },
  { angle: "List / roundup", title: "7 Autumn Outfits Worth Saving", bg: "from-emerald-900 via-stone-500 to-stone-300" },
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

  const svg = overlaySvg({ width: 400, height: 600, title: sampleTitle, template: t, logoHref: logoUrl });
  const mix = t.style === "auto";
  const sel = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm md:col-span-2">
      <div>
        <h2 className="text-lg font-semibold">Pin design</h2>
        <p className="text-sm text-zinc-600">Every new pin image gets the title written on it in this style, with your colours, handle and logo.</p>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        {mix ? (
          <div className="grid w-full shrink-0 grid-cols-5 gap-2 sm:max-w-[520px]" aria-label="Designer mix preview: five layouts">
            {SAMPLES.map((p) => (
              <figure key={p.angle} className="flex flex-col gap-1">
                <div className={`relative aspect-[2/3] overflow-hidden rounded-md bg-gradient-to-b ${p.bg}`}>
                  <div
                    className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: overlaySvg({ width: 400, height: 600, title: p.title, template: t, logoHref: logoUrl, angle: p.angle }) }}
                  />
                </div>
                <figcaption className="text-center text-[10px] capitalize text-zinc-500">{layoutFor(t, p.angle, p.title)}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="relative aspect-[2/3] w-full max-w-[260px] shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-stone-400 via-amber-700 to-stone-800" aria-label="Pin design preview">
            <div className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            <span className="absolute left-2 top-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">Preview</span>
          </div>
        )}
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Style
            <select className={sel} value={t.style} onChange={(e) => setT({ ...t, style: e.target.value as PinTemplate["style"] })}>
              {TEMPLATE_STYLES.map((s) => (
                <option key={s} value={s}>{STYLE_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Colour palette
            <select className={sel} value={t.palette} onChange={(e) => setT({ ...t, palette: e.target.value as PinTemplate["palette"] })}>
              {PALETTES.map((p) => (
                <option key={p} value={p}>{PALETTE_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Font{mix ? " (Designer mix pairs its own serif + sans)" : ""}
            <select className={sel} value={t.font} disabled={mix} onChange={(e) => setT({ ...t, font: e.target.value as PinTemplate["font"] })}>
              {TEMPLATE_FONTS.map((f) => (
                <option key={f} value={f}>{FONT_LABELS[f]}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input type="color" value={t.primary_color} onChange={(e) => setT({ ...t, primary_color: e.target.value })} className="h-8 w-10 rounded border border-zinc-300" />
            Brand colour
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input type="color" value={t.text_color} onChange={(e) => setT({ ...t, text_color: e.target.value })} className="h-8 w-10 rounded border border-zinc-300" />
            Text colour
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 sm:col-span-2">
            Handle or website shown on the pin
            <input className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm" maxLength={40} placeholder="@yourbrand or yoursite.com" value={t.handle} onChange={(e) => setT({ ...t, handle: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2">
            <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-50">
              {t.logo ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => pickLogo(e.target.files?.[0])} />
            </label>
            {t.logo && (
              <button onClick={() => setT({ ...t, logo: null })} className="text-red-700 hover:underline">Remove logo</button>
            )}
            <span className="text-xs text-zinc-500">PNG or JPEG, under 300 KB. A square logo works best.</span>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button onClick={save} disabled={busy} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save pin design</button>
            {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
