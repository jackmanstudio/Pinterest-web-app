/** Other sizes a pin image can be exported in, for reuse outside Pinterest. */
export const EXPORT_SIZES = [
  { id: "square", label: "Square 1:1 (Instagram post, Pinterest square)", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait 4:5 (Instagram, Facebook feed)", width: 1080, height: 1350 },
  { id: "story", label: "Story 9:16 (Stories, Reels, Idea pins)", width: 1080, height: 1920 },
  { id: "wide", label: "Wide 1.91:1 (blog header, link preview)", width: 1200, height: 630 },
  { id: "pin", label: "Pinterest 2:3 (1000 × 1500)", width: 1000, height: 1500 },
] as const;
export type ExportSizeId = (typeof EXPORT_SIZES)[number]["id"];
export type FitMode = "fit" | "fill";

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Where to draw a source image inside a target box.
 * fit: the whole image is visible (the rest is a blurred backdrop, so pin text is never cut).
 * fill: the image covers the box and the edges are cropped, centred.
 */
export function placeImage(src: { width: number; height: number }, box: { width: number; height: number }, mode: FitMode): Rect {
  const scale = mode === "fit" ? Math.min(box.width / src.width, box.height / src.height) : Math.max(box.width / src.width, box.height / src.height);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  return { x: Math.round((box.width - w) / 2), y: Math.round((box.height - h) / 2), w, h };
}
