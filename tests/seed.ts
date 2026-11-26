import { LocalStore, type KeyValue } from "@/lib/store/local";
import type { ImageCache } from "@/lib/client/imageCache";

/** Test setup: two accounts ("fashion" and "macro" templates). Real users start with none. */
export function seedAccounts(kv: KeyValue) {
  kv.setItem(
    "pin-ai-studio:v1:workspaces",
    JSON.stringify([
      { kind: "fashion", niche: "fashion", name: "Fashion" },
      { kind: "macro", niche: "macro", name: "Macro" },
    ]),
  );
  return kv;
}

export const seededStore = (kv: KeyValue, images: ImageCache | null = null) => new LocalStore(seedAccounts(kv), images);
