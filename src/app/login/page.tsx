"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AuthShell, Field, GoogleButton, PasswordField, SubmitButton, postAuth } from "@/components/auth/AuthUi";
import { looksLikeEmail, safeNext } from "@/lib/auth/checks";
import { demoSignIn } from "@/lib/auth/demo";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once after hydration
    setNext(safeNext(q.get("next")));
    if (q.get("error") === "link") setError("That link has expired or was already used. Sign in, or request a new link.");
    if (q.get("reset") === "1") setInfo("Your password was changed. Sign in with the new password.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    setFields({});
    if (!isSupabaseConfigured) {
      // Demo sign-in: this browser only, nothing is checked against a server.
      if (!looksLikeEmail(email)) {
        setFields({ email: "Enter a valid email address." });
        setBusy(false);
        return;
      }
      demoSignIn({ email });
      window.location.assign(next);
      return;
    }
    try {
      await postAuth("/api/auth/login", { email, password, remember });
      // A full navigation so every page loads with the new session cookies.
      window.location.assign(next);
    } catch (err) {
      const e2 = err as Error & { fields?: Record<string, string> };
      setError(e2.message);
      setFields(e2.fields ?? {});
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue to your studio."
      footer={
        <>
          New to Pin AI Studio?{" "}
          <Link href="/signup" className="font-medium text-[#2a1416] underline underline-offset-2">Create an account</Link>
        </>
      }
    >
      <GoogleButton next={next} />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {info && <Alert tone="success">{info}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} placeholder="you@example.com" />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={fields.password}
          right={<Link href="/forgot-password" className="text-xs font-medium text-[#b3262e] hover:underline">Forgot password?</Link>}
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-[#2a1416]" />
          Remember me on this device
        </label>
        <SubmitButton busy={busy}>{busy ? "Signing in…" : "Sign in"}</SubmitButton>
        {!isSupabaseConfigured && (
          <button
            type="button"
            onClick={() => {
              demoSignIn({ email: "demo@example.com" });
              window.location.assign(next);
            }}
            className="text-sm font-medium text-[#b3262e] hover:underline"
          >
            Skip and continue as a demo user
          </button>
        )}
      </form>
    </AuthShell>
  );
}
