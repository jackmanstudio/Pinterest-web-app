"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { demoSignIn } from "@/lib/auth/demo";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Alert, AuthShell, Field, GoogleButton, PasswordField, SubmitButton, postAuth } from "@/components/auth/AuthUi";
import { SignupSchema, fieldErrors } from "@/lib/auth/validation";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirmPassword: "" });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { ...form, acceptTerms: accept };
    const local = SignupSchema.safeParse(body);
    if (!local.success) {
      setFields(fieldErrors(local.error));
      return;
    }
    setFields({});
    setBusy(true);
    if (!isSupabaseConfigured) {
      demoSignIn({ name: local.data.fullName, email: local.data.email });
      window.location.assign("/dashboard");
      return;
    }
    try {
      const r = await postAuth<{ verify: boolean }>("/api/auth/signup", body);
      if (r.verify) setSentTo(local.data.email);
      else {
        router.replace("/welcome");
        router.refresh();
      }
    } catch (err) {
      const e2 = err as Error & { fields?: Record<string, string> };
      setError(e2.message);
      setFields(e2.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your inbox" subtitle="One last step to activate your account.">
        <Alert tone="success">
          If <strong>{sentTo}</strong> can be used for a new account, we&apos;ve sent a verification link to it. Open it to activate your account, then you&apos;ll go straight to
          setup.
        </Alert>
        <p className="mt-4 text-sm text-zinc-600">
          No email after a few minutes? Check spam, or <button className="font-medium underline" onClick={() => setSentTo(null)}>try again</button>. Already have an account?{" "}
          <Link href="/login" className="font-medium underline">Sign in</Link>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your studio"
      subtitle="Turn keywords into polished, organised Pinterest pins."
      footer={
        <>
          Already have an account? <Link href="/login" className="font-medium text-[#2a1416] underline underline-offset-2">Sign in</Link>
        </>
      }
    >
      <GoogleButton next="/welcome" />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" autoComplete="name" required value={form.fullName} onChange={(e) => set("fullName")(e.target.value)} error={fields.fullName} placeholder="Ayesha Khan" maxLength={100} />
        <Field label="Email address" type="email" autoComplete="email" required value={form.email} onChange={(e) => set("email")(e.target.value)} error={fields.email} placeholder="you@example.com" />
        <PasswordField label="Password" autoComplete="new-password" value={form.password} onChange={set("password")} error={fields.password} meter context={{ email: form.email, name: form.fullName }} />
        <PasswordField label="Confirm password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} error={fields.confirmPassword ?? (form.confirmPassword && form.confirmPassword !== form.password ? "The passwords don't match." : undefined)} />
        <div>
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-[#2a1416]" aria-invalid={Boolean(fields.acceptTerms)} />
            <span>
              I agree to the{" "}
              <Link href="/terms" target="_blank" className="font-medium underline">Terms of Service</Link> and{" "}
              <Link href="/privacy" target="_blank" className="font-medium underline">Privacy Policy</Link>.
            </span>
          </label>
          {fields.acceptTerms && <p className="mt-1 text-xs text-red-700">{fields.acceptTerms}</p>}
        </div>
        <SubmitButton busy={busy}>{busy ? "Creating your account…" : "Create account"}</SubmitButton>
      </form>
    </AuthShell>
  );
}
