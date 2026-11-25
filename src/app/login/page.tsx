"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto mt-24 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900">
        <h1 className="text-lg font-semibold">Demo mode: sign-in is off</h1>
        <p className="mt-2 text-sm">
          Supabase isn&apos;t configured, so there are no accounts. Data is kept only in this browser. Set
          <code className="mx-1">NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sign-in.
        </p>
        <Link href="/w/fashion" className="mt-4 inline-block text-sm font-medium underline">Continue in Demo mode</Link>
      </main>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const auth = getBrowserSupabase().auth;
    const { data, error } =
      mode === "signin"
        ? await auth.signInWithPassword({ email, password })
        : await auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setBusy(false);
    if (error) return setMsg({ text: error.message, ok: false });
    if (mode === "signup" && !data.session) return setMsg({ text: "Check your email to confirm your account, then sign in.", ok: true });
    router.replace("/w/fashion");
    router.refresh();
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-red-700">Pinterest AI Studio</h1>
      <p className="mt-1 text-sm text-zinc-600">{mode === "signin" ? "Sign in to your studio" : "Create your studio account"}</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" required autoComplete="email" className="rounded-md border border-zinc-300 px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy} className="rounded-md bg-red-700 py-2 font-medium text-white disabled:opacity-50">
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</p>}
      <button className="mt-4 text-sm text-zinc-600 underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </main>
  );
}
