"use client";
import { PageTitle } from "./PageTitle";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PasswordField, postAuth } from "@/components/auth/AuthUi";
import { passwordProblems } from "@/lib/auth/validation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { WORKSPACE_KINDS, WORKSPACE_LABELS, type WorkspaceKind } from "@/lib/types";

interface Profile {
  email: string;
  pending_email: string | null;
  email_confirmed: boolean;
  providers: string[];
  created_at: string;
  last_sign_in_at: string | null;
  full_name: string;
  prefs: Record<"notify_publish_failures" | "notify_weekly_summary" | "notify_product_updates", boolean>;
  needs_migration: boolean;
}
interface Conn {
  kind: WorkspaceKind;
  username: string | null;
  status: string | null;
  ready: boolean;
}

const card = "rounded-lg border border-zinc-200 bg-white p-5";
const input = "mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

function Status({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p> : null;
}

/** Account settings (spec 12): name, email, password, notifications, Pinterest connections. */
export function AccountSettings() {
  const [p, setP] = useState<Profile | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (isSupabaseConfigured) {
      fetch("/api/auth/profile")
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? "Could not load your account.");
          if (!cancelled) setP(b);
        })
        .catch((e: Error) => !cancelled && setLoadErr(e.message));
    }
    Promise.all(
      WORKSPACE_KINDS.map((k) =>
        fetch(`/api/pinterest/status?workspace=${k}`)
          .then((r) => r.json())
          .then((s) => ({ kind: k, username: s.connection?.username ?? null, status: s.connection?.status ?? null, ready: Boolean(s.config?.ready) }))
          .catch(() => ({ kind: k, username: null, status: null, ready: false })),
      ),
    ).then((c) => !cancelled && setConns(c));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageTitle title="Your" accent="account" sub="Your profile, sign-in, notifications and connected Pinterest accounts." />
      {!isSupabaseConfigured ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo mode: there are no accounts, so name, email and password settings are off. Connect Supabase to turn them on.
        </p>
      ) : loadErr ? (
        <p role="alert" className="text-sm text-red-700">{loadErr}</p>
      ) : !p ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <>
          {p.needs_migration && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Run <code>supabase/migrations/0010_profiles.sql</code> in the Supabase SQL editor to save your name and notification choices.
            </p>
          )}
          <ProfileCard p={p} onSaved={(np) => setP({ ...p, ...np })} />
          {p.providers.includes("email") ? <PasswordCard /> : (
            <section className={card}>
              <h2 className="font-semibold">Password</h2>
              <p className="mt-1 text-sm text-zinc-600">You sign in with {p.providers.join(", ")}. Use “Forgot password” on the sign-in page if you want to add a password.</p>
            </section>
          )}
          <NotificationsCard p={p} onSaved={(prefs) => setP({ ...p, prefs })} />
        </>
      )}

      <section className={card}>
        <h2 className="font-semibold">Pinterest connections</h2>
        <p className="mt-1 text-sm text-zinc-600">Each account (Fashion, Macro) connects its own Pinterest profile. Disconnecting deletes the stored tokens.</p>
        <ul className="mt-3 divide-y divide-zinc-100">
          {conns.map((c) => (
            <li key={c.kind} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-20 font-medium">{WORKSPACE_LABELS[c.kind]}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "active" ? "bg-emerald-100 text-emerald-800" : c.status ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-700"}`}>
                {c.status === "active" ? `Connected · @${c.username}` : c.status ? `Needs reconnect · @${c.username}` : c.ready ? "Not connected" : "Pinterest not configured"}
              </span>
              <Link href={`/w/${c.kind}/pinterest`} className="ml-auto text-sm underline">{c.status ? "Manage or disconnect" : "Connect"}</Link>
            </li>
          ))}
        </ul>
      </section>
      {p && (
        <p className="text-xs text-zinc-500">
          Account created {new Date(p.created_at).toLocaleDateString()}
          {p.last_sign_in_at ? ` · last sign-in ${new Date(p.last_sign_in_at).toLocaleString()}` : ""}
        </p>
      )}
    </div>
  );
}

function ProfileCard({ p, onSaved }: { p: Profile; onSaved: (x: Partial<Profile>) => void }) {
  const [name, setName] = useState(p.full_name);
  const [email, setEmail] = useState(p.email);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name.trim() !== p.full_name || email.trim().toLowerCase() !== p.email;
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, string> = {};
      if (name.trim() !== p.full_name) body.full_name = name.trim();
      if (email.trim().toLowerCase() !== p.email) body.email = email.trim();
      const r = await postAuth<{ emailSent: boolean }>("/api/auth/profile", body, "PATCH");
      onSaved({ full_name: name.trim(), ...(r.emailSent ? { pending_email: email.trim().toLowerCase() } : {}) });
      if (r.emailSent) setEmail(p.email);
      setMsg({ ok: true, text: r.emailSent ? "Check both inboxes: confirm the change from the links we sent. Your email changes after that." : "Saved." });
    } catch (e) {
      const e2 = e as Error & { fields?: Record<string, string> };
      setMsg({ ok: false, text: Object.values(e2.fields ?? {})[0] ?? e2.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Profile</h2>
      <label className="mt-3 block text-sm">
        Full name
        <input className={input} value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mt-3 block text-sm">
        Email
        <input className={input} type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        {p.email_confirmed ? "Verified." : "Not verified yet."}
        {p.pending_email ? ` Waiting for you to confirm ${p.pending_email}.` : ""}
      </p>
      <button disabled={busy || !dirty} onClick={save} className={`${primary} mt-3`}>{busy ? "Saving…" : "Save profile"}</button>
      <Status msg={msg} />
    </section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const probs = passwordProblems(pw);
    if (probs.length) return setFields({ password: `Password needs: ${probs.join(", ").toLowerCase()}.` });
    if (pw !== confirm) return setFields({ confirmPassword: "The passwords don't match." });
    setFields({});
    setBusy(true);
    try {
      await postAuth("/api/auth/password", { currentPassword: current, password: pw, confirmPassword: confirm });
      setCurrent("");
      setPw("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other devices were signed out." });
    } catch (err) {
      const e2 = err as Error & { fields?: Record<string, string> };
      setFields(e2.fields ?? {});
      setMsg({ ok: false, text: e2.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Change password</h2>
      <form onSubmit={save} className="mt-3 flex max-w-sm flex-col gap-3" noValidate>
        <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} error={fields.currentPassword} />
        <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={setPw} error={fields.password} meter />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={fields.confirmPassword} />
        <button disabled={busy || !current || !pw} className={`${primary} self-start`}>{busy ? "Saving…" : "Change password"}</button>
      </form>
      <Status msg={msg} />
    </section>
  );
}

const PREF_LABELS: Record<keyof Profile["prefs"], string> = {
  notify_publish_failures: "When a scheduled pin fails to publish",
  notify_weekly_summary: "Weekly summary of published pins",
  notify_product_updates: "Product news and new features",
};

function NotificationsCard({ p, onSaved }: { p: Profile; onSaved: (prefs: Profile["prefs"]) => void }) {
  const [prefs, setPrefs] = useState(p.prefs);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(p.prefs);
  async function save() {
    setMsg(null);
    try {
      await postAuth("/api/auth/profile", { prefs }, "PATCH");
      onSaved(prefs);
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Email notifications</h2>
      <div className="mt-3 flex flex-col gap-2">
        {(Object.keys(PREF_LABELS) as (keyof Profile["prefs"])[]).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="h-4 w-4 accent-zinc-900" />
            {PREF_LABELS[k]}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Your choices are saved now. These emails start once an email provider is set up for the app; failures always show in the app too.</p>
      <button disabled={!dirty} onClick={save} className={`${primary} mt-3`}>Save notifications</button>
      <Status msg={msg} />
    </section>
  );
}
