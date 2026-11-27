"use client";
import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";

/** Last-resort screen when even the app layout crashes. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError({ kind: "render", message: `Layout crashed: ${error.message}`, stack: error.stack, digest: error.digest });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b0912", color: "#fff", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ opacity: 0.8, fontSize: 14 }}>The error was recorded automatically.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: 0, cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
