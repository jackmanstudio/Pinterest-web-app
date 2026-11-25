"use client";
import { indexedDbImageCache } from "@/lib/client/imageCache";
import { LocalStore } from "./local";
import type { Store } from "./types";

let store: Store | null = null;

/** Browser-only store for Demo mode, without the Supabase client in the bundle. */
export function getDemoStore(): Store {
  store ??= new LocalStore(window.localStorage, typeof indexedDB === "undefined" ? null : indexedDbImageCache);
  return store;
}
