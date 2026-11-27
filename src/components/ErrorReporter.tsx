"use client";
import { useEffect } from "react";

type Report = { message: string; stack?: string; digest?: string; kind: "error" | "unhandledrejection" | "render" | "fetch"; status?: number; api?: string; errorId?: string };

const sent = new Map<string, number>();

/** Sends one browser-side error to the error log. Same error is sent at most once a minute; at most 20 per page load. */
export function reportClientError(r: Report) {
  if (typeof window === "undefined") return;
  const key = `${r.kind}:${r.api ?? ""}:${r.message}`.slice(0, 300);
  const now = Date.now();
  if ((sent.get(key) ?? 0) > now - 60_000 || sent.size > 20) return;
  sent.set(key, now);
  const body = JSON.stringify({ ...r, message: r.message.slice(0, 2000), stack: r.stack?.slice(0, 8000), route: window.location.pathname });
  try {
    void originalFetch?.("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {}
}

let originalFetch: typeof fetch | null = null;

/**
 * Catches uncaught browser errors, unhandled promise rejections and failed
 * API calls (5xx the server did not already log, and network failures), and
 * records them with the page they happened on.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (!e.message || /ResizeObserver loop/.test(e.message)) return;
      reportClientError({ kind: "error", message: e.message, stack: e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}` });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r instanceof DOMException && r.name === "AbortError") return;
      reportClientError({ kind: "unhandledrejection", message: r instanceof Error ? r.message : String(r), stack: r instanceof Error ? r.stack : undefined });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    originalFetch = window.fetch.bind(window);
    const base = originalFetch;
    const wrapped: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.startsWith("/") ? url.split("?")[0] : (() => { try { const u = new URL(url); return u.origin === window.location.origin ? u.pathname : null; } catch { return null; } })();
      const isApi = Boolean(path?.startsWith("/api/") && !path.startsWith("/api/errors"));
      try {
        const res = await base(input, init);
        if (isApi && res.status >= 500 && !res.headers.get("x-error-id")) {
          const text = await res.clone().text().catch(() => "");
          let msg = text.slice(0, 500);
          try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch {}
          reportClientError({ kind: "fetch", api: `${init?.method ?? "GET"} ${path}`, status: res.status, message: msg || `HTTP ${res.status}` });
        }
        return res;
      } catch (err) {
        if (isApi && !(err instanceof DOMException && err.name === "AbortError")) {
          reportClientError({ kind: "fetch", api: `${init?.method ?? "GET"} ${path}`, status: 0, message: `Network error: ${err instanceof Error ? err.message : String(err)}` });
        }
        throw err;
      }
    };
    window.fetch = wrapped;
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (window.fetch === wrapped) window.fetch = base;
    };
  }, []);
  return null;
}
