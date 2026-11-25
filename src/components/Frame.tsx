"use client";
import dynamic from "next/dynamic";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

// The sidebar shell is only needed on app pages, so sign-in pages don't download or hydrate it.
const AppShell = dynamic(() => import("./AppShell").then((m) => m.AppShell));

const AUTH_SEGMENTS = new Set(["login", "signup", "forgot-password", "reset-password"]);

/** Picks the bare frame for sign-in pages and the full app shell for everything else. */
export function Frame({ children }: { children: ReactNode }) {
  // The route actually rendered, not the address bar: "/" shows the sign-in page in place for signed-out visitors.
  const segment = useSelectedLayoutSegment();
  if (segment && AUTH_SEGMENTS.has(segment)) return <main className="flex-1">{children}</main>;
  return <AppShell>{children}</AppShell>;
}
