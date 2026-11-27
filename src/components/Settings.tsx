"use client";
import { PageTitle } from "./PageTitle";
import { useEffect, useState } from "react";
import { parseList } from "@/lib/drafts/validation";
import type { BrandSettings, Category, WorkspaceKind } from "@/lib/types";
import { labelFromSlug } from "@/lib/types";
import { useWorkspace } from "./useWorkspace";
import { PinDesign } from "./PinDesign";
import { readTemplate } from "@/lib/brand/template";
import { defaultCategories } from "@/lib/categories/taxonomy";

import { LANGUAGES } from "@/lib/brand/languages";
import { WorkspaceError } from "./WorkspaceError";
const IMAGE_STYLES = ["Editorial photography", "Lifestyle photography", "Flat lay", "Studio product shot", "Illustration", "Minimal still life", "Moody film photography"];

export function Settings({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [kw, setKw] = useState("");
  const [banned, setBanned] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState("");
  const [newParent, setNewParent] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [filling, setFilling] = useState(false);
  // Shown right under "Fill brand from my website", not at the bottom of the form.
  const [siteMsg, setSiteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [designKey, setDesignKey] = useState(0);

  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.getBrand(workspace.id), store.listCategories(workspace.id)])
      .then(([b, c]) => {
        setBrand(b);
        setKw(b.focus_keywords.join(", "));
        setBanned(b.banned_words.join(", "));
        setCategories(c);
        setDisplayName(workspace.name);
      })
      .catch((e: Error) => setMsg({ text: e.message, ok: false }));
  }, [store, workspace]);

  if (wsError) return <WorkspaceError error={wsError} />;
  if (!store || !workspace || !brand) return <p className="text-zinc-500">Loading settings…</p>;

  const input = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
  const field = (k: "brand_name" | "voice" | "audience" | "website_url", label: string, multiline = false) => (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      {label}
      {multiline ? (
        <textarea id={k} className={input} rows={2} value={brand[k]} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
      ) : (
        <input id={k} className={input} value={brand[k]} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
      )}
    </label>
  );

  /** Brand analysis from the website: suggestions only, saved when you click Save. */
  async function fillFromSite() {
    setFilling(true);
    setSiteMsg(null);
    try {
      const res = await fetch("/api/tools/brand-from-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: brand!.website_url, workspace: kind }) });
      const s = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(s.error ?? "Couldn't read your website.");
      const t = readTemplate(brand!.pin_template);
      let logo = t.logo;
      if (s.logo && !t.logo) {
        const blob = await (await fetch(s.logo)).blob();
        logo = await store!.uploadLogo(workspace!.id, new File([blob], "logo.png", { type: "image/png" }));
      }
      const filled: string[] = [];
      const next: BrandSettings = { ...brand!, website_url: s.website_url ?? brand!.website_url };
      if (!next.brand_name && s.brand_name) {
        next.brand_name = s.brand_name;
        filled.push("brand name");
      }
      const a = s.analysis as { voice: string; audience: string; image_style: string; cta: string } | null;
      if (a) {
        const fill = (k: "voice" | "audience" | "image_style" | "cta", v: string, label: string) => {
          if (v?.trim() && !next[k]?.trim()) {
            next[k] = v.trim();
            filled.push(label);
          }
        };
        fill("voice", a.voice, "brand voice");
        fill("audience", a.audience, "audience");
        fill("image_style", a.image_style, "image style");
        fill("cta", a.cta, "call to action");
      }
      if (s.keywords?.length) {
        const merged = parseList([kw, ...s.keywords].filter(Boolean).join(", ")).slice(0, 15);
        setKw(merged.join(", "));
        filled.push("keywords");
      }
      next.pin_template = { ...t, ...(s.color && t.primary_color === "#b91c1c" ? { primary_color: s.color } : {}), logo };
      if (s.color) filled.push("brand colour");
      if (logo && logo !== t.logo) filled.push("logo");
      setBrand(next);
      setDesignKey((k) => k + 1);
      const kept = "Fields you had already filled were kept.";
      const base = filled.length ? `Filled from your site: ${filled.join(", ")}. ${kept} Check them, then Save.` : `Nothing new to fill: ${kept}`;
      setSiteMsg({ text: s.analysis_note ? `${base} ${s.analysis_note}` : base, ok: true });
    } catch (e) {
      setSiteMsg({ text: (e as Error).message, ok: false });
    } finally {
      setFilling(false);
    }
  }

  async function saveBrand() {
    try {
      const next = { ...brand!, focus_keywords: parseList(kw), banned_words: parseList(banned) };
      await store!.saveBrand(workspace!.id, next);
      if (displayName.trim() && displayName.trim() !== workspace!.name) await store!.renameWorkspace(workspace!.id, displayName);
      setBrand(next);
      setMsg({ text: `${displayName.trim() || workspace?.name || labelFromSlug(kind)} brand settings saved.`, ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  async function addCategory() {
    try {
      const c = await store!.addCategory(workspace!.id, newCat, newParent || null);
      setCategories([...categories, c]);
      setNewCat("");
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  /** Adds any of the spec's starter categories that are missing (keeps the user's own). */
  async function restoreDefaults() {
    try {
      const have = new Set(categories.filter((c) => !c.parent_id).map((c) => c.name.toLowerCase()));
      const added = [];
      for (const name of defaultCategories(workspace!.niche)) if (!have.has(name.toLowerCase())) added.push(await store!.addCategory(workspace!.id, name));
      setCategories([...categories, ...added]);
      setMsg({ text: added.length ? `Added ${added.length} starter categories.` : "All starter categories are already there.", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  async function removeCategory(id: string) {
    try {
      await store!.deleteCategory(workspace!.id, id);
      setCategories(categories.filter((c) => c.id !== id && c.parent_id !== id));
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="md:col-span-2">
        <PageTitle kind={kind} title="Brand &" accent="categories" sub={`Used only for ${labelFromSlug(kind)} generations. Each of your other accounts has its own settings.`} />
      </div>
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold">Brand settings</h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Account display name
          <input className={input} value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        {field("brand_name", "Brand name")}
        {field("voice", "Brand voice", true)}
        {field("audience", "Target audience", true)}
        {field("website_url", "Website URL")}
        <button type="button" onClick={fillFromSite} disabled={filling || !brand.website_url.trim()} className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50">
          {filling ? "Reading your site…" : "Fill brand from my website"}
        </button>
        {siteMsg && <p className={`text-sm ${siteMsg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{siteMsg.text}</p>}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Focus keywords (comma separated)
          <input className={input} value={kw} onChange={(e) => setKw(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Banned words (comma separated)
          <input className={input} value={banned} onChange={(e) => setBanned(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Preferred image style
          <input className={input} list="image-styles" placeholder="e.g. Editorial photography" maxLength={120} value={brand.image_style ?? ""} onChange={(e) => setBrand({ ...brand, image_style: e.target.value })} />
          <datalist id="image-styles">{IMAGE_STYLES.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Default call to action
          <input className={input} placeholder="e.g. Save this for your next trip" maxLength={120} value={brand.cta ?? ""} onChange={(e) => setBrand({ ...brand, cta: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Pin language
            <select className={input} value={brand.language ?? ""} onChange={(e) => setBrand({ ...brand, language: e.target.value })}>
              <option value="">English (default)</option>
              {LANGUAGES.filter((l) => l !== "English").map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            SEO market / region
            <input className={input} placeholder="e.g. United States" maxLength={60} value={brand.region ?? ""} onChange={(e) => setBrand({ ...brand, region: e.target.value })} />
          </label>
        </div>
        <button onClick={saveBrand} className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Save brand settings</button>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{labelFromSlug(kind)} categories</h2>
        {categories.length === 0 && <p className="text-sm text-zinc-600">No categories yet. Add the ones this workspace uses.</p>}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{categories.filter((c) => !c.parent_id).length} categories · {categories.filter((c) => c.parent_id).length} sub-categories</span>
          <button onClick={restoreDefaults} className="underline hover:text-zinc-900">Add missing starter categories</button>
        </div>
        <ul className="flex max-h-[28rem] flex-col divide-y divide-zinc-100 overflow-y-auto pr-1">
          {categories
            .filter((c) => !c.parent_id)
            .map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.name}</span>
                  <button onClick={() => removeCategory(c.id)} className="text-red-700 hover:underline">Remove</button>
                </div>
                {categories.some((s) => s.parent_id === c.id) && (
                  <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-3">
                    {categories
                      .filter((s) => s.parent_id === c.id)
                      .map((s) => (
                        <li key={s.id} className="flex items-center justify-between text-zinc-700">
                          {s.name}
                          <button onClick={() => removeCategory(s.id)} className="text-xs text-red-700 hover:underline">Remove</button>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
        </ul>
        <form
          className="flex flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) addCategory();
          }}
        >
          <input className={input} placeholder={newParent ? "New sub-category" : "New category"} value={newCat} maxLength={80} onChange={(e) => setNewCat(e.target.value)} />
          <select aria-label="Parent category" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 text-sm sm:flex-none" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
            <option value="">Top level</option>
            {categories.filter((c) => !c.parent_id).map((c) => (
              <option key={c.id} value={c.id}>Under {c.name}</option>
            ))}
          </select>
          <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">Add</button>
        </form>
      </section>

      <PinDesign
        key={designKey}
        store={store}
        workspaceId={workspace.id}
        brand={brand}
        sampleTitle={workspace?.niche === "fashion" ? "7 Autumn Trench Coat Outfits Worth Saving" : "Your Pin Title Goes Right Here"}
        onSaved={setBrand}
      />
    </div>
  );
}
