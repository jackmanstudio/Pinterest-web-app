"use client";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";

let store: Store | null = null;

export function getStore(): Store {
  store ??= isSupabaseConfigured ? new SupabaseStore(getBrowserSupabase()) : new LocalStore(window.localStorage);
  return store;
}
export type { Store, NewDraft } from "./types";
