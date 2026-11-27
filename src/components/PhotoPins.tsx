"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/store";
import type { WorkspaceKind } from "@/lib/types";
import { blobToBase64, decodePhoto, toJpeg } from "@/lib/photos/client";
import { useTrendKeywords } from "@/lib/client/useTrendKeywords";
import { duplicateNotice, fileProblem, PHOTO_LIMITS, sizeCheck, topicFromFileName } from "@/lib/photos/validate";

/** Hex SHA-256 of a file's bytes, or null when the browser can't hash it. */
async function fileHash(f: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

interface Picked {
  key: string;
  name: string;
  preview: string;
  img: ImageBitmap | null;
  topic: string;
  /** SHA-256 of the file, so the same photo is not made into two pins. */
  hash: string | null;
  problem: string | null;
  tip: string | null;
  state: "ready" | "writing" | "saved" | "failed";
  error?: string;
}

const card = "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm";

/**
 * Up to 50 of the user's own photos become pin drafts: the photo is the pin
 * image and the AI writes title, description, tags and alt text for each.
 * Nothing is published: drafts go to the library and Review as usual.
 */
export function PhotoPins({ kind, store, workspaceId, onSaved }: { kind: WorkspaceKind; store: Store; workspaceId: string; onSaved: () => void }) {
  const [photos, setPhotos] = useState<Picked[]>([]);
  const trendKeywords = useTrendKeywords(kind);
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null);
    const room = PHOTO_LIMITS.maxFiles - photos.length;
    const list = [...files].slice(0, Math.max(0, room));
    const skipped = files.length - list.length;
    const added: Picked[] = [];
    const seen = new Set(photos.map((p) => p.hash).filter(Boolean) as string[]);
    const dupes: string[] = [];
    for (const f of list) {
      const hash = await fileHash(f);
      if (hash && seen.has(hash)) {
        dupes.push(f.name);
        continue;
      }
      if (hash) seen.add(hash);
      const preview = URL.createObjectURL(f);
      urls.current.push(preview);
      const base: Picked = { key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, preview, img: null, topic: topicFromFileName(f.name), hash, problem: fileProblem(f), tip: null, state: "ready" };
      if (!base.problem) {
        try {
          base.img = await decodePhoto(f);
          const s = sizeCheck(base.img.width, base.img.height);
          base.problem = s.problem;
          base.tip = s.tip;
        } catch (e) {
          base.problem = (e as Error).message;
        }
      }
      added.push(base);
    }
    setPhotos((p) => [...p, ...added]);
    const notes = [duplicateNotice(dupes), skipped > 0 ? `Only ${PHOTO_LIMITS.maxFiles} photos at a time; ${skipped} were left out.` : null].filter(Boolean);
    if (notes.length) setNotice(notes.join(" "));
    if (input.current) input.current.value = "";
  }

  const update = (key: string, patch: Partial<Picked>) => setPhotos((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const usable = photos.filter((p) => !p.problem && p.state !== "saved");
  const count = (s: Picked["state"]) => photos.filter((p) => p.state === s).length;

  async function run() {
    setRunning(true);
    setNote(null);
    const brand = await store.getBrand(workspaceId);
    const batchId = crypto.randomUUID();
    const todo = usable.filter((p) => p.state !== "saved");
    for (let i = 0; i < todo.length; i += PHOTO_LIMITS.batch) {
      const group = todo.slice(i, i + PHOTO_LIMITS.batch);
      group.forEach((p) => update(p.key, { state: "writing", error: undefined }));
      try {
        const jpegs = await Promise.all(group.map(async (p) => blobToBase64(await toJpeg(p.img!, PHOTO_LIMITS.aiLongSide, 0.8))));
        const res = await fetch("/api/photo-pins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: kind, brand, topic: topic.trim(), language: brand.language || undefined, trend_keywords: trendKeywords.length ? trendKeywords : undefined, photos: group.map((p, j) => ({ topic: p.topic.trim(), jpeg: jpegs[j] })) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Writing the pin text failed (${res.status}).`);
        if (body.basedOn === "topic") setNote("This AI can't look at photos, so the text was written from your topic. Check each pin matches its photo.");
        for (const [j, p] of group.entries()) {
          try {
            const t = body.pins[j];
            const [draft] = await store.saveDrafts(workspaceId, [
              {
                idea: p.topic.trim() || topic.trim() || t.title,
                title: t.title,
                description: t.description,
                tags: t.tags,
                alt_text: t.alt_text,
                link: link.trim() || null,
                angle: "Your photo",
                concept: "Made from your own photo",
                image_prompt: "The user's own photo (uploaded)",
                batch_id: batchId,
                category_id: null,
                source: body.source === "ai" ? "ai" : "demo",
              },
            ]);
            await store.attachPhoto(workspaceId, draft.id, await toJpeg(p.img!, PHOTO_LIMITS.storeLongSide));
            update(p.key, { state: "saved" });
          } catch (e) {
            update(p.key, { state: "failed", error: (e as Error).message });
          }
        }
      } catch (e) {
        group.forEach((p) => update(p.key, { state: "failed", error: (e as Error).message }));
      }
    }
    setRunning(false);
    onSaved();
  }

  const done = count("saved");
  return (
    <section id="photos" className={card} aria-label="Pins from your photos">
      <h2 className="text-lg font-semibold">Make pins from your photos</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Add up to {PHOTO_LIMITS.maxFiles} photos (JPG, PNG or WebP). Each one becomes a draft pin with its own title, description, tags and alt text. Nothing is posted: you review and
        publish them as usual.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <button onClick={() => input.current?.click()} disabled={running || photos.length >= PHOTO_LIMITS.maxFiles} className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {photos.length ? "Add more photos" : "Choose photos"}
        </button>
        <input ref={input} type="file" multiple accept={"image/jpeg,image/png,image/webp"} className="hidden" onChange={(e) => pick(e.target.files)} aria-label="Photos" />
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
          Topic for all photos (optional)
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="e.g. winter outfits for women" className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-normal" />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
          Destination link for all (optional)
          <input value={link} onChange={(e) => setLink(e.target.value)} maxLength={2048} placeholder="https://…" className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-normal" />
        </label>
      </div>
      {notice && <p className="mt-2 text-xs text-amber-800">{notice}</p>}

      {photos.length > 0 && (
        <>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {photos.map((p) => (
              <li key={p.key} className="flex flex-col gap-1 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={p.preview} alt="" className={`aspect-[2/3] w-full rounded object-cover ${p.problem ? "opacity-40" : ""}`} />
                <input
                  value={p.topic}
                  onChange={(e) => update(p.key, { topic: e.target.value })}
                  disabled={running || p.state === "saved" || Boolean(p.problem)}
                  maxLength={200}
                  aria-label={`Note for ${p.name}`}
                  placeholder="What is it? (optional)"
                  className="rounded border border-zinc-300 px-1.5 py-0.5"
                />
                {p.problem ? (
                  <span className="text-red-700">{p.problem}</span>
                ) : p.state === "saved" ? (
                  <span className="text-emerald-700">✓ Draft saved</span>
                ) : p.state === "writing" ? (
                  <span className="text-zinc-500">Writing…</span>
                ) : p.state === "failed" ? (
                  <span className="text-red-700">{p.error}</span>
                ) : (
                  p.tip && <span className="text-amber-800">{p.tip}</span>
                )}
                {!running && p.state !== "saved" && (
                  <button onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))} className="self-start text-zinc-500 underline">Remove</button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <button onClick={run} disabled={running || usable.length === 0} className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50">
              {running ? "Making pins…" : `Make ${usable.length} pin${usable.length === 1 ? "" : "s"}`}
            </button>
            <span className="text-zinc-600" role="status">
              {photos.length} photo{photos.length === 1 ? "" : "s"} · {photos.filter((p) => p.problem).length} can&apos;t be used · {done} saved · {count("failed")} failed
            </span>
            {done > 0 && !running && (
              <Link href={`/w/${kind}/publish`} className="font-medium text-red-700 underline">Review the new pins</Link>
            )}
          </div>
          {note && <p className="mt-2 text-xs text-amber-800">{note}</p>}
        </>
      )}
    </section>
  );
}
