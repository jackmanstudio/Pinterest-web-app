import type { TemplateStyle } from "@/lib/brand/template";
import type { WorkspaceKind } from "@/lib/types";

/**
 * Builds the final prompt sent to the image model. The draft's image prompt
 * gives the scene; this adds the pin title (so the picture matches it), a
 * Pinterest-style aesthetic, lighting and composition cues, room for the title
 * overlay, and things to avoid. Written as plain sentences, which FLUX, GPT
 * Image and Nano Banana all follow well (none of them take a negative prompt).
 */
export interface ImagePromptInput {
  title: string;
  scene: string;
  kind: WorkspaceKind;
  /** Where the title overlay will sit, so the image keeps that area calm. */
  overlay?: TemplateStyle;
  /** The draft's angle (key or label); picks a distinct art direction per pin. */
  angle?: string;
}

/** One distinct look per angle, so a set of five never looks samey. */
const ART_DIRECTION: Record<string, string> = {
  how_to: "Art direction: a clean overhead flat lay with deliberate spacing on a tactile surface (linen, marble or warm wood), soft daylight, styled like a premium magazine shopping page.",
  list: "Art direction: an authentic full-length street-style moment, candid mid-stride, interesting architecture behind, shallow depth of field.",
  inspiration: "Art direction: cinematic and dreamy, golden-hour backlight with a soft glow, subtle film grain, painterly colour grading.",
  problem_solution: "Art direction: a bold studio shot on a seamless colour-blocked backdrop that complements the subject, crisp directional light, graphic and modern.",
  seasonal: "Art direction: a rich seasonal lifestyle set with tactile props, warm layered lighting, cosy and inviting atmosphere.",
};
const ART_FALLBACK = Object.values(ART_DIRECTION);

function artDirection(angle: string | undefined, title: string): string {
  const a = (angle ?? "").toLowerCase();
  const key = a.includes("how") ? "how_to" : a.includes("list") ? "list" : a.includes("inspir") ? "inspiration" : a.includes("problem") ? "problem_solution" : a.includes("season") ? "seasonal" : null;
  if (key) return ART_DIRECTION[key];
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ART_FALLBACK[h % ART_FALLBACK.length];
}

const AESTHETIC: Record<WorkspaceKind, string> = {
  fashion:
    "High-end fashion editorial photograph, luxury fashion magazine and Pinterest aesthetic: a stylish, well-fitted outfit with realistic fabric texture, tasteful accessories, refined and harmonious colour palette, aspirational yet wearable.",
  macro:
    "Premium editorial photograph with a clean, modern Pinterest aesthetic: one clear subject, tasteful styling, refined and harmonious colour palette, aspirational and trustworthy.",
};

const SPACE: Record<TemplateStyle, string> = {
  subtle: "Keep the bottom edge of the frame simple, because a small caption will sit there.",
  bold: "Keep the lower third of the frame calm and softly blurred (simple background, no important details) because a title band will be placed there.",
  minimal: "Keep the lower third of the frame darker and uncluttered because a white title will be placed there.",
  elegant: "Keep the upper third of the frame calm and uncluttered (sky, wall or soft background) because a title card will be placed there.",
  editorial: "Keep the upper third of the frame calm and uncluttered because a magazine-style headline will be placed there.",
  none: "Use the full frame.",
};

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    // Ask for one scene: strip leftover requests for text, numbers or layouts models render badly.
    .replace(/\b(vertical\s+)?2:3\b/gi, "")
    .replace(/,?\s*(with\s+)?(bold\s+)?(number(ed)?\s+(badges|labels|panels)|text overlay space[^,.]*|minimal text[^,.]*)/gi, "")
    .trim();

export function buildImagePrompt({ title, scene, kind, overlay = "subtle", angle }: ImagePromptInput): string {
  // Never quote the title: image models copy quoted words into the picture as (misspelled) text.
  const t = title
    .replace(/["“”'‘’:!?]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 140);
  const sceneText = clean(scene).slice(0, 700) || t;
  return [
    "A clean photograph with absolutely no text, lettering or typography anywhere in the image.",
    `Vertical 2:3 portrait photo for a Pinterest pin about ${t}. The photo must clearly show this subject.`,
    `Scene: ${sceneText}`,
    AESTHETIC[kind],
    artDirection(angle, t),
    "Make it distinctive and original, not a generic stock photo: one unexpected but tasteful detail, a considered colour story and a scroll-stopping focal point.",
    "Composition: a single cohesive scene with one clear focal point, rule of thirds, generous negative space, depth with a softly blurred background.",
    "Light and finish: soft natural light, gentle shadows, true-to-life skin and fabric textures, rich but natural colours, crisp focus on the subject, shot on a full-frame camera with a 50mm lens, magazine-quality retouching.",
    SPACE[overlay],
    "Again: no text, letters, words, numbers, captions, headlines, signs, logos, watermarks or signatures; collages, grids, split screens, borders or frames; extra or distorted fingers, hands or faces; clutter, harsh flash, oversaturated colours, cartoon or CGI look, cliché stock-photo poses.",
  ].join("\n");
}
