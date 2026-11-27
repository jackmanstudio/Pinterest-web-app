/** Rules for the user's own photos turned into pins (checked in the browser before upload). */
export const PHOTO_LIMITS = {
  maxFiles: 50,
  maxBytes: 20 * 1024 * 1024,
  /** Shortest side below this looks blurry on Pinterest. */
  minSide: 300,
  /** Stored pin image: longest side, JPEG (Pinterest's API takes PNG or JPEG). */
  storeLongSide: 2000,
  /** Copy sent to the AI to read the photo. */
  aiLongSide: 768,
  /** Photos per AI request. */
  batch: 5,
} as const;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Problem with a picked file before it is opened, or null. */
export function fileProblem(f: { name: string; type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(f.type)) return `${f.name}: only JPG, PNG or WebP photos can be used.`;
  if (f.size === 0) return `${f.name}: the file is empty.`;
  if (f.size > PHOTO_LIMITS.maxBytes) return `${f.name}: the file is larger than 20 MB.`;
  return null;
}

/** Problem with a photo's size in pixels, or null; plus a soft tip about the 2:3 shape. */
export function sizeCheck(width: number, height: number): { problem: string | null; tip: string | null } {
  if (!width || !height) return { problem: "The photo could not be read (it may be damaged).", tip: null };
  if (Math.min(width, height) < PHOTO_LIMITS.minSide) return { problem: `Too small (${width}×${height}). Use a photo at least ${PHOTO_LIMITS.minSide} px on each side.`, tip: null };
  const ratio = width / height;
  const tip = ratio > 0.8 ? "Wide or square photo: tall 2:3 photos (like 1000×1500) get more attention on Pinterest." : null;
  return { problem: null, tip };
}

/** Fit inside a box of `long` px on the longest side, never enlarging. */
export function fitSize(width: number, height: number, long: number): { width: number; height: number } {
  const scale = Math.min(1, long / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** "my-winter_coat 2.jpg" -> "my winter coat 2": a fallback topic from the file name. */
export function topicFromFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^(img|dsc|pxl|image|photo)[-_ ]?\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Message for photos left out because the same photo was already added, or null. */
export function duplicateNotice(names: string[]): string | null {
  if (!names.length) return null;
  const list = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `${names.length === 1 ? "This photo is" : "These photos are"} already in the list, so ${names.length === 1 ? "it was" : "they were"} not added again: ${list}.`;
}

/**
 * The topic a photo's text is written from when the AI can't see photos: the
 * "topic for all photos" when one is typed, else the photo's own topic. Null
 * when neither has 3+ letters.
 */
export function photoTopic(own: string, shared: string): string | null {
  const t = shared.trim().length >= 3 ? shared.trim() : own.trim();
  return t.length >= 3 ? t : null;
}
