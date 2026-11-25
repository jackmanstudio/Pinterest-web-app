"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearRememberCookie, getBrowserSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { demoSignOut } from "@/lib/auth/demo";
import { WORKSPACE_KINDS, WORKSPACE_LABELS, isWorkspaceKind } from "@/lib/types";
import { StatusSummary } from "./StatusBar";

type IconName = "home" | "spark" | "library" | "calendar" | "boards" | "check" | "bolt" | "brand" | "chart" | "coin" | "pin" | "tools" | "grid" | "user" | "out" | "menu" | "close";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  library: "M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  boards: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  check: "M4 12.5 9 17.5 20 6.5",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  brand: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5",
  pin: "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  tools: "M14 7a4 4 0 0 0 5 5l-8 8a2 2 0 0 1-3-3l8-8a4 4 0 0 0-2-2z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
};

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

interface Item { section: string; label: string; icon: IconName }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Create", items: [{ section: "", label: "Studio", icon: "spark" }, { section: "drafts", label: "Pin library", icon: "library" }, { section: "tools", label: "Tools", icon: "tools" }] },
  { title: "Publish", items: [{ section: "publish", label: "Review & publish", icon: "check" }, { section: "calendar", label: "Calendar", icon: "calendar" }, { section: "boards", label: "Boards", icon: "boards" }, { section: "autopilot", label: "Autopilot", icon: "bolt" }] },
  { title: "Insights", items: [{ section: "analytics", label: "Analytics", icon: "chart" }, { section: "usage", label: "Usage & cost", icon: "coin" }] },
  { title: "Setup", items: [{ section: "settings", label: "Brand & categories", icon: "brand" }, { section: "pinterest", label: "Pinterest", icon: "pin" }] },
];

const AUTH = /^\/(login|signup|forgot-password|reset-password)/;

/** App frame for signed-in pages: sidebar on desktop, top bar + drawer + bottom tabs on phones. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    // Close the phone menu after any navigation.
    setLastPath(path);
    setOpen(false);
  }
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (AUTH.test(path)) return <main className="flex-1">{children}</main>;

  const seg = path.split("/");
  const inWorkspace = seg[1] === "w" && isWorkspaceKind(seg[2] ?? "");
  const kind = inWorkspace ? seg[2] : "fashion";
  const section = inWorkspace ? (seg[3] ?? "") : null;

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      demoSignOut();
      window.location.assign("/login");
      return;
    }
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    await getBrowserSupabase().auth.signOut({ scope: "local" }).catch(() => {});
    clearRememberCookie();
    router.replace("/login");
    router.refresh();
  };

  const navLink = (href: string, label: string, icon: IconName, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all ${active ? "bg-gradient-to-r from-rose-500/25 to-rose-500/5 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-white/65 hover:bg-white/[0.06] hover:text-white"}`}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-rose-400 to-amber-300" aria-hidden />}
      <Icon name={icon} className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? "text-rose-300" : "text-white/40 group-hover:text-white/80"}`} />
      {label}
    </Link>
  );

  const switcher = (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.07] p-1 ring-1 ring-white/10" role="tablist" aria-label="Workspace">
      {WORKSPACE_KINDS.map((k) => (
        <Link
          key={k}
          role="tab"
          aria-selected={k === kind}
          href={`/w/${k}${section ? `/${section}` : ""}`}
          className={`rounded-lg px-3 py-1.5 text-center text-sm font-semibold transition-all ${k === kind ? "bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-lg shadow-rose-900/40" : "text-white/60 hover:text-white"}`}
        >
          {WORKSPACE_LABELS[k]}
        </Link>
      ))}
    </div>
  );

  const nav = (
    <>
      <div className="px-3">{switcher}</div>
      <nav className="mt-4 flex flex-col gap-4 px-3" aria-label="Sections">
        <div className="flex flex-col gap-0.5">
          {navLink("/dashboard", "Dashboard", "home", path === "/dashboard")}
          {navLink("/overview", "All accounts", "grid", path === "/overview")}
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{g.title}</p>
            {g.items.map((it) => navLink(`/w/${kind}${it.section ? `/${it.section}` : ""}`, it.label, it.icon, section === it.section))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-3 pt-6">
        <div className="rounded-xl bg-white/[0.05] p-3 ring-1 ring-white/10">
          <p className="mb-2 px-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">System</p>
          <StatusSummary dark />
        </div>
        <div className="flex flex-col gap-0.5">
          {navLink("/account", "Account", "user", path === "/account")}
          <button onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-white/65 hover:bg-white/[0.06] hover:text-white">
            <Icon name="out" className="h-[18px] w-[18px] text-white/40" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  const logo = (size: string) => (
    <span className={`grid ${size} shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500 via-red-600 to-red-800 text-white shadow-lg shadow-rose-900/40 ring-1 ring-white/20`}>
      <Icon name="pin" className="h-4 w-4" />
    </span>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
      {logo("h-9 w-9")}
      <span className="leading-tight">
        Pinterest <span className="bg-gradient-to-r from-rose-300 to-amber-200 bg-clip-text text-transparent">AI</span> Studio
        <span className="block text-[11px] font-normal text-white/45">Pin creation suite</span>
      </span>
    </Link>
  );

  const current = GROUPS.flatMap((g) => g.items).find((it) => it.section === section);
  const crumb: [string, string] | null = inWorkspace && current ? [`${WORKSPACE_LABELS[kind as keyof typeof WORKSPACE_LABELS]} workspace`, current.label] : null;

  const bottom: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: "/dashboard", label: "Home", icon: "home", active: path === "/dashboard" },
    { href: `/w/${kind}`, label: "Studio", icon: "spark", active: section === "" },
    { href: `/w/${kind}/drafts`, label: "Library", icon: "library", active: section === "drafts" },
    { href: `/w/${kind}/publish`, label: "Review", icon: "check", active: section === "publish" },
  ];

  return (
    <div className="flex min-h-full flex-1">
      {/* Desktop sidebar */}
      <aside className="app-scroll sticky top-0 hidden h-screen w-[17rem] shrink-0 flex-col overflow-y-auto bg-[#1f0f12] py-5 lg:flex" style={{ backgroundImage: "radial-gradient(420px 260px at 0% 0%, rgba(225,29,72,0.22), transparent 70%), radial-gradient(360px 300px at 100% 100%, rgba(217,119,6,0.10), transparent 70%)" }}>
        <div className="mb-6 px-6">{brand}</div>
        {nav}
        <div className="h-4 shrink-0" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone / tablet top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-[#1f0f12]/95 px-4 py-2.5 shadow-lg shadow-black/10 backdrop-blur lg:hidden">
          <Link href="/dashboard" aria-label="Pinterest AI Studio home">{logo("h-9 w-9")}</Link>
          <div className="w-44">{switcher}</div>
          <button onClick={() => setOpen(true)} className="ml-auto rounded-xl p-2 text-white/80 hover:bg-white/10" aria-label="Open menu" aria-expanded={open}>
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </header>

        <main className="app-main mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {crumb && (
            <div className="mb-5 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <span className="rounded-full bg-white px-2.5 py-1 text-zinc-700 shadow-sm ring-1 ring-zinc-900/5">{crumb[0]}</span>
              <span aria-hidden>›</span>
              <span className="text-zinc-800">{crumb[1]}</span>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Phone drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto bg-[#1f0f12] py-4 shadow-2xl" style={{ backgroundImage: "radial-gradient(360px 240px at 100% 0%, rgba(225,29,72,0.22), transparent 70%)" }}>
            <div className="mb-4 flex items-center justify-between px-6">
              <span className="text-sm font-semibold text-white/50">Menu</span>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Close menu">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {nav}
            <div className="h-4 shrink-0" />
          </div>
        </div>
      )}

      {/* Phone bottom tabs */}
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl bg-white/90 p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_12px_32px_-8px_rgba(24,24,27,0.3)] ring-1 ring-zinc-900/5 backdrop-blur-xl lg:hidden" aria-label="Quick">
        {bottom.map((b) => (
          <Link key={b.label} href={b.href} className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-colors ${b.active ? "bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-md shadow-rose-900/30" : "text-zinc-500"}`}>
            <Icon name={b.icon} className="h-5 w-5" />
            {b.label}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold text-zinc-500">
          <Icon name="menu" className="h-5 w-5" />
          More
        </button>
      </nav>
    </div>
  );
}
