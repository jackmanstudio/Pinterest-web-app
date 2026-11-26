"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const DEMO_PREFIX = "pin-ai-studio:";
const LIVE_CONFIRM = "DELETE MY ACCOUNT";
const DEMO_CONFIRM = "CLEAR DEMO DATA";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function demoKeys(): string[] {
  return Object.keys(window.localStorage).filter((k) => k.startsWith(DEMO_PREFIX));
}

export function AccountData() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = isSupabaseConfigured;
  const CONFIRM = live ? LIVE_CONFIRM : DEMO_CONFIRM;

  const exportData = async () => {
    setErr(null);
    setMsg(null);
    const stamp = new Date().toISOString().slice(0, 10);
    if (!live) {
      const data = Object.fromEntries(demoKeys().map((k) => [k, JSON.parse(window.localStorage.getItem(k) ?? "null")]));
      download(`pinterest-ai-studio-demo-export-${stamp}.json`, JSON.stringify({ mode: "demo", exported_at: new Date().toISOString(), data }, null, 2));
      setMsg("Demo data exported from this browser.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
      download(`pinterest-ai-studio-export-${stamp}.json`, await res.text());
      setMsg("Export downloaded. Pinterest tokens are never included.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setErr(null);
    setMsg(null);
    if (confirm !== CONFIRM) return;
    if (!live) {
      demoKeys().forEach((k) => window.localStorage.removeItem(k));
      setConfirm("");
      setMsg("Demo data cleared from this browser. Reload to start fresh.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm, password: password || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Delete failed (${res.status})`);
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Your data</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {live
            ? "Your data is stored in Supabase with row-level security. Each account stays separate in the export too."
            : "Demo mode: your pins and settings are saved only in this browser's local storage. To write pins and make images, your idea and brand settings are sent to the server and its AI provider; they are not stored there."}
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Export your data</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Downloads a JSON file with all your accounts: brand settings, categories, drafts, publish history, analytics snapshots,
          AI usage and the audit log. Pinterest access tokens are never exported.
        </p>
        <button
          onClick={exportData}
          disabled={busy}
          className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {live ? "Download export" : "Download demo data"}
        </button>
      </section>

      <section className="rounded-lg border border-red-200 bg-white p-5">
        <h2 className="font-semibold text-red-800">{live ? "Delete account" : "Clear demo data"}</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {live
            ? "Permanently deletes your account, all its Pinterest accounts, all drafts, images and the stored Pinterest connection. Pins already published on Pinterest are not touched. This cannot be undone, so export first."
            : "Removes all demo workspaces, drafts and images from this browser."}
        </p>
        <label className="mt-3 block text-sm">
          Type <span className="font-mono font-semibold">{CONFIRM}</span> to confirm
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
            aria-label="Confirmation text"
          />
        </label>
        {live && (
          <label className="mt-3 block text-sm">
            Your password (leave empty if you only sign in with Google)
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>
        )}
        <button
          onClick={remove}
          disabled={busy || confirm !== CONFIRM}
          className="mt-3 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {live ? "Delete my account" : "Clear demo data"}
        </button>
      </section>

      {msg && <p role="status" className="text-sm text-green-800">{msg}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
