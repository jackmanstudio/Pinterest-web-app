"use client";
import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";

/** Shown when a page crashes. The crash is recorded with an ID the user can send us. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError({ kind: "render", message: error.message || "Page crashed", stack: error.stack, digest: error.digest });
  }, [error]);
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-zinc-800 shadow-sm" role="alert">
      <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-zinc-600">The error was recorded automatically. Try again, and if it keeps happening, send us the reference below.</p>
      {error.digest ? (
        <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-700">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button onClick={reset} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Try again</button>
        <a href="/account#errors" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm">See error log</a>
      </div>
    </div>
  );
}
