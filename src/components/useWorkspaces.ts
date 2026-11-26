"use client";
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Workspace } from "@/lib/types";

const EVENT = "pin-ai-studio:workspaces-changed";

/** Tell every open list of accounts (sidebar, dashboard) to reload. */
export function announceWorkspacesChanged() {
  window.dispatchEvent(new Event(EVENT));
}

let cache: Workspace[] | null = null;

/** All of the signed-in user's accounts, oldest first. Reloads after an add, rename or delete. */
export function useWorkspaces() {
  const [state, setState] = useState<{ list: Workspace[] | null; error: string | null }>({ list: cache, error: null });
  const load = useCallback(() => {
    let cancelled = false;
    // Demo mode loads the browser store only, so the Supabase client stays out of the page shell.
    (isSupabaseConfigured ? import("@/lib/store").then((m) => m.getStore()) : import("@/lib/store/demo").then((m) => m.getDemoStore()))
      .then((store) => store.listWorkspaces())
      .then((list) => {
        cache = list;
        if (!cancelled) setState({ list, error: null });
      })
      .catch((e: Error) => !cancelled && setState((s) => ({ list: s.list, error: e.message })));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let stop = load();
    const again = () => {
      stop();
      stop = load();
    };
    window.addEventListener(EVENT, again);
    return () => {
      stop();
      window.removeEventListener(EVENT, again);
    };
  }, [load]);
  return state;
}
