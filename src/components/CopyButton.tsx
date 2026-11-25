"use client";
import { useState } from "react";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Small "Copy" button that confirms with "Copied". */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "fail");
        setTimeout(() => setState("idle"), 1500);
      }}
      className={`text-xs text-zinc-500 underline decoration-zinc-300 hover:text-zinc-900 ${className}`}
    >
      {state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : label}
    </button>
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
