"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AuthShell, PasswordField, SubmitButton, postAuth } from "@/components/auth/AuthUi";
import { passwordProblems } from "@/lib/auth/validation";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const p = passwordProblems(password);
    if (p.length) return setFields({ password: `Password needs: ${p.join(", ").toLowerCase()}.` });
    if (password !== confirm) return setFields({ confirmPassword: "The passwords don't match." });
    setFields({});
    setBusy(true);
    try {
      await postAuth("/api/auth/password", { password, confirmPassword: confirm });
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      router.replace("/login?reset=1");
    } catch (err) {
      const e2 = err as Error & { fields?: Record<string, string> };
      setError(e2.message);
      setFields(e2.fields ?? {});
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Use something strong that you don't use anywhere else."
      footer={<Link href="/forgot-password" className="font-medium text-[#2a1416] underline underline-offset-2">Need a new link?</Link>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <PasswordField label="New password" autoComplete="new-password" value={password} onChange={setPassword} error={fields.password} meter />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={fields.confirmPassword} />
        <SubmitButton busy={busy}>{busy ? "Saving…" : "Save new password"}</SubmitButton>
        <p className="text-xs text-zinc-500">For your security, you&apos;ll be signed out everywhere and asked to sign in again.</p>
      </form>
    </AuthShell>
  );
}
