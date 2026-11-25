"use client";
import { useState } from "react";

/**
 * Copies text. Embedded browsers (e.g. inside desktop apps) often block the
 * Clipboard API, so it falls back to a hidden textarea + execCommand("copy").
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Small "Copy" button that confirms with "Copied". */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={async () => {
          const ok = await copyText(text);
          setState(ok ? "ok" : "fail");
          if (ok) setTimeout(() => setState("idle"), 1500);
        }}
        className={`text-xs text-zinc-500 underline decoration-zinc-300 hover:text-zinc-900 ${className}`}
      >
        {state === "ok" ? "Copied" : label}
      </button>
      {state === "fail" && (
        // Last resort: show the text selected, so Ctrl+C / Cmd+C copies it.
        <span className="mt-1 flex flex-col gap-1 text-xs">
          <span className="text-zinc-600">Your browser blocked copying. The text is selected below: press Ctrl+C (Cmd+C on Mac).</span>
          <textarea
            readOnly
            autoFocus
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setState("idle")}
            rows={Math.min(6, text.split("\n").length + 1)}
            className="w-64 rounded border border-zinc-300 p-1 text-xs"
          />
        </span>
      )}
    </span>
  );
}

/** The whole pin as plain text, ready to paste into Pinterest or a doc. */
export function pinAsText(d: { title: string; description: string; tags: string[]; alt_text: string; link?: string | null }): string {
  return [
    `Title: ${d.title}`,
    `Description: ${d.description}`,
    `Tags: ${d.tags.join(", ")}`,
    `Alt text: ${d.alt_text}`,
    d.link ? `Link: ${d.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
