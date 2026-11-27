"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "./NavLink";
import { usePathname, useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { demoSignOut } from "@/lib/auth/demo";
import { isWorkspaceKind, labelFromSlug } from "@/lib/types";
import { useWorkspaces } from "./useWorkspaces";
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

  const { list: workspaces } = useWorkspaces();
  const seg = path.split("/");
  const inWorkspace = seg[1] === "w" && isWorkspaceKind(seg[2] ?? "");
  const [lastKind, setLastKind] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (inWorkspace) window.localStorage.setItem("pin-ai-studio:last-account", seg[2]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from browser storage
      else setLastKind(window.localStorage.getItem("pin-ai-studio:last-account"));
    } catch {
      /* storage blocked: fall back to the first account */
    }
  }, [inWorkspace, seg[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  // Outside an account page: the last account used, else the first. Null = no accounts (yet).
  const fallback = workspaces ? (workspaces.find((w) => w.kind === lastKind)?.kind ?? workspaces[0]?.kind ?? null) : lastKind;
  const kind: string | null = inWorkspace ? seg[2] : fallback;
  /** Where account pages point when the user has no account yet. */
  const ADD = "/overview?add=1";
  // No account yet: still show every page, and remember which one was picked so the
  // add-account form can open it right after the account is made.
  const at = (sub: string) => (kind ? `/w/${kind}${sub ? `/${sub}` : ""}` : `${ADD}&next=${sub || "studio"}`);
  const section = inWorkspace ? (seg[3] ?? "") : null;

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      demoSignOut();
      window.location.assign("/login");
      return;
    }
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Loaded only when signing out, so the Supabase client isn't in every page's bundle.
    const { clearRememberCookie, getBrowserSupabase } = await import("@/lib/supabase/client");
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
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors ${active ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
    >
      <Icon name={icon} className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[#ff8a6a]" : "text-white/40 group-hover:text-white/80"}`} />
      {label}
    </Link>
  );

  const options = workspaces ?? [];
  const noAccounts = workspaces !== null && workspaces.length === 0 && !inWorkspace;
  const switcher = noAccounts ? (
    <Link
      href={ADD}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] py-2 text-[13px] font-bold text-white shadow-[0_6px_20px_-6px_rgba(255,90,60,0.7)] ring-1 ring-white/10"
    >
      + Add your first account
    </Link>
  ) : (
    <label className="relative block">
      <span className="sr-only">Account</span>
      <select
        value={kind && options.some((w) => w.kind === kind) ? kind : ""}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v === "__add" ? "/overview?add=1" : `/w/${v}${section ? `/${section}` : ""}`);
        }}
        className="w-full appearance-none truncate rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] py-2 pl-3 pr-8 text-[13px] font-bold text-white shadow-[0_6px_20px_-6px_rgba(255,90,60,0.7)] outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {!options.some((w) => w.kind === kind) && <option value="">{kind ? (workspaces === null ? labelFromSlug(kind) : "Account not found") : "Choose account"}</option>}
        {options.map((w) => (
          <option key={w.kind} value={w.kind} className="bg-[#1a1426] text-white">
            {w.name}
          </option>
        ))}
        <option value="__add" className="bg-[#1a1426] text-white">+ Add account</option>
      </select>
      <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/90" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );

  const nav = (
    <>
      <div className="px-3">{switcher}</div>
      <nav className="mt-4 flex flex-col gap-4 px-3" aria-label="Sections">
        <div className="flex flex-col gap-0.5">
          {navLink("/dashboard", "Dashboard", "home", path === "/dashboard")}
          {navLink("/overview", "All accounts", "grid", path === "/overview")}
        </div>
        {noAccounts && (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] leading-snug text-white/60">
            Add an account to open these pages. Each page opens right after.
          </p>
        )}
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/55">{g.title}</p>
            {g.items.map((it) => navLink(at(it.section), it.label, it.icon, section === it.section))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-3 pt-6">
        <div className="au-glass rounded-xl p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">System</p>
          <StatusSummary dark />
        </div>
        <div className="flex flex-col gap-0.5">
          {navLink("/account", "Account", "user", path === "/account")}
          <button onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-white/60 hover:bg-white/[0.05] hover:text-white">
            <Icon name="out" className="h-[18px] w-[18px] text-white/40" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  const logo = (size: string) => (
    <span className={`grid ${size} shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7c3aed] via-[#a855f7] to-[#f59e0b] text-white shadow-[0_0_24px_-4px_rgba(168,85,247,0.7)]`}>
      <Icon name="pin" className="h-4 w-4" />
    </span>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-[16px] font-extrabold tracking-tight text-white">
      {logo("h-9 w-9")}
      <span>Pin AI Studio</span>
    </Link>
  );

  const current = GROUPS.flatMap((g) => g.items).find((it) => it.section === section);
  const kindName = (kind && workspaces?.find((w) => w.kind === kind)?.name) || (kind ? (workspaces === null ? labelFromSlug(kind) : "Account not found") : "");
  const crumb: [string, string] | null = inWorkspace && current ? [kindName, current.label] : null;
  const tabTitle = crumb ? `${crumb[1]} · ${crumb[0]} · Pin AI Studio` : null;
  // Account pages share one layout, so name the browser tab after the section and account.
  useEffect(() => {
    if (tabTitle) document.title = tabTitle;
  }, [tabTitle]);

  const bottom: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: "/dashboard", label: "Home", icon: "home", active: path === "/dashboard" },
    { href: at(""), label: "Studio", icon: "spark", active: section === "" },
    { href: at("drafts"), label: "Library", icon: "library", active: section === "drafts" },
    { href: at("publish"), label: "Review", icon: "check", active: section === "publish" },
  ];

  return (
    <div className="au-body flex min-h-full flex-1">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-white/[0.03] py-5 lg:flex">
        <div className="mb-5 px-5">{brand}</div>
        {nav}
        <div className="h-4 shrink-0" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone / tablet top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.07] bg-[#0b0912]/90 px-4 py-2.5 lg:hidden">
          <Link href="/dashboard" aria-label="Pin AI Studio home">{logo("h-8 w-8")}</Link>
          <div className="w-44">{switcher}</div>
          <button onClick={() => setOpen(true)} className="ml-auto rounded-xl p-2.5 text-white hover:bg-white/10" aria-label="Open menu" aria-expanded={open}>
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </header>

        <main className="app-main mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {crumb && (
            <div className="mb-5 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <span className="text-white/50">{crumb[0]}</span>
              <span aria-hidden className="text-white/25">/</span>
              <span className="font-semibold text-white">{crumb[1]}</span>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Phone drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(19rem,86vw)] flex-col overflow-y-auto border-l border-white/10 bg-[#120e1c] py-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between px-6">
              <span className="text-base font-bold text-white">Menu</span>
              <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-white hover:bg-white/10" aria-label="Close menu">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {nav}
            <div className="h-4 shrink-0" />
          </div>
        </div>
      )}

      {/* Phone bottom tabs */}
      <nav className="au-glass fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl !bg-[#1a1426]/95 px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] lg:hidden" aria-label="Quick">
        {bottom.map((b) => (
          <Link key={b.label} href={b.href} className={`relative flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold transition-colors ${b.active ? "text-white" : "text-white/50"}`}>
            <span className={`grid h-8 w-12 place-items-center rounded-xl ${b.active ? "bg-gradient-to-r from-[#e60023] to-[#ff7a45] text-white" : ""}`}>
              <Icon name={b.icon} className="h-5 w-5" />
            </span>
            {b.label}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold text-white/50">
          <span className="grid h-8 w-12 place-items-center"><Icon name="menu" className="h-5 w-5" /></span>
          More
        </button>
      </nav>
    </div>
  );
}
