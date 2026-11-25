"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AuthShell, Field, SubmitButton, postAuth } from "@/components/auth/AuthUi";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once after hydration
    if (new URLSearchParams(window.location.search).get("error") === "expired") setError("That reset link has expired or was already used. Request a new one below.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postAuth("/api/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={<Link href="/login" className="font-medium text-[#2a1416] underline underline-offset-2">Back to sign in</Link>}
    >
      {sent ? (
        <Alert tone="success">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. It works once and expires in about an hour.
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <SubmitButton busy={busy}>{busy ? "Sending…" : "Send reset link"}</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
