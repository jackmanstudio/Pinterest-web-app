"use client";
import { useEffect, useState } from "react";
import { getStore, type Store } from "@/lib/store";
import type { Workspace, WorkspaceKind } from "@/lib/types";

export function useWorkspace(kind: WorkspaceKind) {
  const [state, setState] = useState<{ store: Store | null; workspace: Workspace | null; error: string | null }>({
    store: null,
    workspace: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    const store = getStore();
    store
      .getWorkspace(kind)
      .then((workspace) => !cancelled && setState({ store, workspace, error: null }))
      .catch((e: Error) => !cancelled && setState({ store, workspace: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return state;
}
