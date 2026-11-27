"use client";
import Link from "next/link";
import localFont from "next/font/local";
import { Suspense, useId, useState, type ReactNode } from "react";
import { passwordProblems, passwordStrength } from "@/lib/auth/checks";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Latin subset of Playfair Display 500 (OFL, see public/fonts/OFL-PlayfairDisplay.txt). Loaded under its own family
// name so it doesn't merge with the full "Playfair Display" TTFs that globals.css declares for pin previews.
const authSerif = localFont({
  src: [
    { path: "../../fonts/playfair-500-latin.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/playfair-500i-latin.woff2", weight: "500", style: "italic" },
  ],
  display: "optional",
  preload: false,
  fallback: ["Georgia", "serif"],
});
const serif = { fontFamily: authSerif.style.fontFamily };

/** Split-screen frame for the sign-in pages: brand panel + form card. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 grid overflow-y-auto bg-[#faf7f2] lg:grid-cols-[1.05fr_1fr]">
      {/* Suspense boundaries let React hydrate the brand panel and the form as separate short tasks. */}
      <Suspense>
      <aside className="relative hidden overflow-hidden bg-[#2a1416] p-12 text-[#f6efe6] lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[#b3262e]/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-[#d8b48a]/20 blur-3xl" />
        <Link href="/" className="relative text-lg font-semibold tracking-tight">
          Pin <span className="text-[#e7b77c]">AI</span> Studio
        </Link>
        <div className="relative max-w-md">
          <p className="text-4xl leading-tight" style={serif}>
            Pins that look <em>designed</em>, boards that stay <em>organised</em>.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-sm text-[#e9ddd0]">
            {["Keyword to finished pin in one click", "AI picks the right board for every pin", "Nothing goes live without your approval"].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e7b77c] text-[11px] font-bold text-[#2a1416]">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-[#c9b9a8]">Your Pinterest tokens are encrypted and never shown in the browser.</p>
      </aside>
      </Suspense>

      <Suspense>
      <section className="flex min-h-full items-center justify-center px-5 py-12">
        <div className="w-full max-w-[26rem]">
          <Link href="/" className="mb-8 block text-center text-lg font-semibold tracking-tight text-[#2a1416] lg:hidden">
            Pin <span className="text-[#b3262e]">AI</span> Studio
          </Link>
          <div className="rounded-2xl border border-[#eadfd2] bg-white p-7 shadow-[0_20px_60px_-30px_rgba(42,20,22,0.35)] sm:p-8">
            <h1 className="text-[1.75rem] leading-tight text-[#2a1416]" style={serif}>{title}</h1>
            <p className="mt-1.5 text-sm text-zinc-600">{subtitle}</p>
            {isSupabaseConfigured ? (
              <div className="mt-6">{children}</div>
            ) : (
              <div className="mt-6">
                <DemoNotice />
                {children}
              </div>
            )}
          </div>
          {footer && <div className="mt-5 text-center text-sm text-zinc-600">{footer}</div>}
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
            Pin AI Studio is an independent tool and is not affiliated with or endorsed by Pinterest.
            This is not a Pinterest sign-in: use your Pin AI Studio email and password, never your Pinterest password.
          </p>
        </div>
      </section>
      </Suspense>
    </div>
  );
}

function DemoNotice() {
  return (
    <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">Demo sign-in</p>
      <p className="mt-0.5">
        Accounts aren&apos;t connected yet, so this signs you in on this browser only. Your name and email stay here; no password is stored or checked.
        Real accounts turn on once Supabase is connected.
      </p>
    </div>
  );
}

const inputCls = (err?: string) =>
  `w-full rounded-lg border bg-white px-3.5 py-2.5 text-[15px] outline-none transition-shadow placeholder:text-zinc-400 focus:ring-4 ${
    err ? "border-red-400 focus:ring-red-100" : "border-zinc-300 focus:border-[#2a1416] focus:ring-[#2a1416]/10"
  }`;

export function Field({
  label,
  error,
  hint,
  right,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; right?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-zinc-800">{label}</label>
        {right}
      </div>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined} className={inputCls(error)} {...props} />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-red-700">{error}</p>
      ) : (
        hint && <div className="text-xs text-zinc-500">{hint}</div>
      )}
    </div>
  );
}

export function PasswordField({
  label,
  error,
  value,
  onChange,
  autoComplete,
  right,
  meter,
  context,
}: {
  label: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  right?: ReactNode;
  meter?: boolean;
  context?: { email?: string; name?: string };
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const strength = value ? Math.max(1, passwordStrength(value)) : 0;
  const problems = meter && value ? passwordProblems(value, context) : [];
  const tones = ["bg-zinc-200", "bg-red-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];
  const words = ["", "Weak", "Fair", "Strong", "Very strong"];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-zinc-800">{label}</label>
        {right}
      </div>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`${inputCls(error)} pr-16`}
          required
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-zinc-600 hover:text-zinc-900"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {meter && value && (
        <div aria-live="polite">
          <div className="flex gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${strength >= i ? tones[strength] : "bg-zinc-200"}`} />
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            {words[strength]}
            {problems.length > 0 && <span className="text-zinc-500"> · Needs: {problems.join(", ").toLowerCase()}</span>}
          </p>
        </div>
      )}
      {error && <p id={`${id}-err`} className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2a1416] px-4 py-2.5 text-[15px] font-medium text-white shadow-sm transition-colors hover:bg-[#3d1d20] disabled:opacity-60"
    >
      {busy && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const cls = { error: "border-red-200 bg-red-50 text-red-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", info: "border-sky-200 bg-sky-50 text-sky-900" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3.5 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}

/** Shown only when NEXT_PUBLIC_AUTH_GOOGLE=true (Google must also be enabled in Supabase Auth). */
export const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true";

export function GoogleButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isSupabaseConfigured) return <GoogleDemo />;
  if (!googleEnabled) return null;
  async function go() {
    setBusy(true);
    setError(null);
    const { getBrowserSupabase } = await import("@/lib/supabase/client");
    const { error: e } = await getBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (e) {
      setError("Google sign-in isn't available right now.");
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-[15px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200" />
        or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
    </>
  );
}

function GoogleLogo() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** In demo mode the Google button is shown but off, so the page looks the way it will. */
function GoogleDemo() {
  return (
    <>
      <button
        type="button"
        disabled
        title="Google sign-in turns on once Supabase is connected"
        className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-[15px] font-medium text-zinc-400"
      >
        <span className="opacity-50"><GoogleLogo /></span>
        Continue with Google
      </button>
      <p className="mt-1.5 text-center text-[11px] text-zinc-500">Google sign-in turns on once Supabase is connected.</p>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200" />
        or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
    </>
  );
}

/** POST JSON to an auth route; returns the body, throwing with field errors attached. */
export async function postAuth<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "Something went wrong. Please try again.") as Error & { fields?: Record<string, string> };
    err.fields = data.fields;
    throw err;
  }
  return data as T;
}
