"use client";
import { useEffect, useState } from "react";
import type { WorkspaceKind } from "@/lib/types";

/**
 * Keywords from the workspace's latest live Pinterest Trends snapshot.
 * Empty in demo mode or when trends were never fetched: nothing is made up.
 */
export function useTrendKeywords(kind: WorkspaceKind): string[] {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    fetch(`/api/analytics?workspace=${kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const data = b?.snapshots?.trends?.data as { keyword?: string }[] | undefined;
        if (!off && Array.isArray(data)) setKeys(data.map((t) => t.keyword ?? "").filter(Boolean).slice(0, 50));
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [kind]);
  return keys;
}
