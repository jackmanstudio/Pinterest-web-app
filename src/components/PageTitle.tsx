import type { ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { labelFromSlug, type WorkspaceKind } from "@/lib/types";

/**
 * The page heading used across the app, matching the dashboard: small chips, a big title with one
 * gradient word, and a short line under it.
 */
export function PageTitle({ title, accent, sub, kind, chips }: { title: string; accent?: string; sub?: ReactNode; kind?: WorkspaceKind; chips?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 basis-full pt-1 sm:basis-auto">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {kind && (
          <span className="au-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold text-white/80">
            <span aria-hidden className={`h-2 w-2 rounded-full bg-[#ff5a4a]`} />
            {labelFromSlug(kind)}
          </span>
        )}
        {!isSupabaseConfigured && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 font-semibold text-amber-200">Demo mode · this browser</span>}
        {chips}
      </div>
      <h1 className="mt-3 text-[2rem] font-bold leading-[1.05] tracking-tight text-white sm:text-[2.75rem]">
        {title}
        {accent && <> <span className="au-grad">{accent}</span></>}
      </h1>
      {sub && <p className="mt-2 max-w-2xl text-[15px] text-white/60">{sub}</p>}
    </div>
  );
}
