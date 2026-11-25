"use client";
import { useEffect, useState } from "react";
import { parseList } from "@/lib/drafts/validation";
import type { BrandSettings, Category, WorkspaceKind } from "@/lib/types";
import { WORKSPACE_LABELS } from "@/lib/types";
import { useWorkspace } from "./useWorkspace";
import { PinDesign } from "./PinDesign";

export function Settings({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [kw, setKw] = useState("");
  const [banned, setBanned] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState("");
  const [newParent, setNewParent] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.getBrand(workspace.id), store.listCategories(workspace.id)])
      .then(([b, c]) => {
        setBrand(b);
        setKw(b.focus_keywords.join(", "));
        setBanned(b.banned_words.join(", "));
        setCategories(c);
      })
      .catch((e: Error) => setMsg({ text: e.message, ok: false }));
  }, [store, workspace]);

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
  if (!store || !workspace || !brand) return <p className="text-zinc-500">Loading settings…</p>;

  const input = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
  const field = (k: "brand_name" | "voice" | "audience" | "website_url", label: string, multiline = false) => (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      {label}
      {multiline ? (
        <textarea className={input} rows={2} value={brand[k]} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
      ) : (
        <input className={input} value={brand[k]} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
      )}
    </label>
  );

  async function saveBrand() {
    try {
      const next = { ...brand!, focus_keywords: parseList(kw), banned_words: parseList(banned) };
      await store!.saveBrand(workspace!.id, next);
      setBrand(next);
      setMsg({ text: `${WORKSPACE_LABELS[kind]} brand settings saved.`, ok: true });
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

  async function removeCategory(id: string) {
    try {
      await store!.deleteCategory(workspace!.id, id);
      setCategories(categories.filter((c) => c.id !== id && c.parent_id !== id));
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold">{WORKSPACE_LABELS[kind]} brand settings</h1>
        <p className="text-sm text-zinc-600">Used only for {WORKSPACE_LABELS[kind]} generations. The other workspace has its own settings.</p>
        {field("brand_name", "Brand name")}
        {field("voice", "Brand voice", true)}
        {field("audience", "Target audience", true)}
        {field("website_url", "Website URL")}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Focus keywords (comma separated)
          <input className={input} value={kw} onChange={(e) => setKw(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
          Banned words (comma separated)
          <input className={input} value={banned} onChange={(e) => setBanned(e.target.value)} />
        </label>
        <button onClick={saveBrand} className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Save brand settings</button>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{WORKSPACE_LABELS[kind]} categories</h2>
        {categories.length === 0 && <p className="text-sm text-zinc-600">No categories yet. Add the ones this workspace uses.</p>}
        <ul className="flex flex-col divide-y divide-zinc-100">
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
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) addCategory();
          }}
        >
          <input className={input} placeholder={newParent ? "New sub-category" : "New category"} value={newCat} maxLength={80} onChange={(e) => setNewCat(e.target.value)} />
          <select aria-label="Parent category" className="rounded-md border border-zinc-300 px-2 text-sm" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
            <option value="">Top level</option>
            {categories.filter((c) => !c.parent_id).map((c) => (
              <option key={c.id} value={c.id}>Under {c.name}</option>
            ))}
          </select>
          <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">Add</button>
        </form>
      </section>

      <PinDesign
        store={store}
        workspaceId={workspace.id}
        brand={brand}
        sampleTitle={kind === "fashion" ? "7 Autumn Trench Coat Outfits Worth Saving" : "Your Pin Title Goes Right Here"}
        onSaved={setBrand}
      />
    </div>
  );
}
