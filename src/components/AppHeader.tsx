"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { WORKSPACE_KINDS, WORKSPACE_LABELS, isWorkspaceKind } from "@/lib/types";
import { StatusBar } from "./StatusBar";

export function AppHeader() {
  const path = usePathname();
  const router = useRouter();
  if (path.startsWith("/login")) return null;
  const seg = path.split("/");
  const kind = seg[1] === "w" && isWorkspaceKind(seg[2] ?? "") ? seg[2] : "fashion";
  const inWorkspace = seg[1] === "w";
  const section = seg[3] ?? "";

  const signOut = async () => {
    await getBrowserSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
    >
      {label}
    </Link>
  );

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href={`/w/${kind}`} className="text-lg font-semibold text-red-700">
          Pinterest AI Studio
        </Link>
        <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1" aria-label="Workspace">
          {WORKSPACE_KINDS.map((k) => (
            <Link
              key={k}
              href={`/w/${k}${section ? `/${section}` : ""}`}
              className={`rounded-md px-3 py-1 text-sm font-medium ${k === kind ? "bg-white shadow-sm" : "text-zinc-600"}`}
            >
              {WORKSPACE_LABELS[k]}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1" aria-label="Sections">
          {tab(`/w/${kind}`, "Studio", inWorkspace && section === "")}
          {tab(`/w/${kind}/drafts`, "Pin library", section === "drafts")}
          {tab(`/w/${kind}/calendar`, "Calendar", section === "calendar")}
          {tab(`/w/${kind}/publish`, "Review & publish", section === "publish")}
          {tab(`/w/${kind}/autopilot`, "Autopilot", section === "autopilot")}
          {tab(`/w/${kind}/settings`, "Brand & categories", section === "settings")}
          {tab(`/w/${kind}/analytics`, "Analytics", section === "analytics")}
          {tab(`/w/${kind}/usage`, "Usage & cost", section === "usage")}
          {tab(`/w/${kind}/pinterest`, "Pinterest", section === "pinterest")}
          {tab(`/w/${kind}/tools`, "Tools", section === "tools")}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/overview" className={`text-sm ${path === "/overview" ? "font-semibold text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}>
            All accounts
          </Link>
          <Link href="/account" className={`text-sm ${path === "/account" ? "font-semibold text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}>
            Account &amp; data
          </Link>
          {isSupabaseConfigured && (
            <button onClick={signOut} className="text-sm text-zinc-600 hover:text-zinc-900">
              Sign out
            </button>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-3">
        <StatusBar />
      </div>
    </header>
  );
}
