import type { TemplateStyle } from "@/lib/brand/template";
import { LAYOUT_PALETTE, layoutForAngle, type Layout, type PaletteName } from "@/lib/brand/design";
import type { WorkspaceNiche } from "@/lib/types";

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
  kind: WorkspaceNiche;
  /** Where the title overlay will sit, so the image keeps that area calm. */
  overlay?: TemplateStyle;
  /** The draft's angle (key or label); picks a distinct art direction per pin. */
  angle?: string;
  /** Brand palette choice, so the photo's colours match the design. */
  palette?: PaletteName;
  /** Brand's preferred image style, e.g. "Editorial photography". */
  imageStyle?: string;
}

/** Colour stories from the design guide; the photo is styled to match the pin's palette. */
const COLOR_STORY: Record<Exclude<PaletteName, "auto" | "brand">, string> = {
  ivory: "Colour story: cream, beige and warm ivory with soft natural wood or linen, gentle warm highlights.",
  sage: "Colour story: sage green with soft neutrals (oatmeal, stone, off-white), fresh and calm.",
  noir: "Colour story: black, white and champagne gold, high-end and moody with refined contrast.",
  blush: "Colour story: dusty rose and muted blush with warm neutrals, soft and romantic.",
  navy: "Colour story: deep navy with elegant cream and a touch of warm brass, timeless and crisp.",
};

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

const AESTHETIC: Record<WorkspaceNiche, string> = {
  fashion:
    "High-end fashion editorial photograph, luxury fashion magazine and Pinterest aesthetic: a stylish, well-fitted outfit with realistic fabric texture, tasteful accessories, refined and harmonious colour palette, aspirational yet wearable.",
  macro:
    "Premium editorial photograph with a clean, modern Pinterest aesthetic: one clear subject, tasteful styling, refined and harmonious colour palette, aspirational and trustworthy.",
};

/** Where the headline goes for each Designer-mix layout, so the subject stays clear of it. */
const LAYOUT_SPACE: Record<Layout, string> = {
  paper: "Place the main subject in the lower two thirds of the frame; the top third will be covered by a paper headline band, so keep only soft background there.",
  framed: "Centre the main subject in the upper three quarters of the frame; the bottom quarter will be covered by a caption, so keep it simple.",
  caption: "Keep the bottom third of the frame calm and simple (floor, table, soft shadow) because an elegant headline will sit there.",
  editorial: "Keep the top third of the frame calm and simple (sky, wall or soft background) because a magazine-style headline will sit there.",
  centered: "Keep the lower-middle of the frame soft and uncluttered (no faces there) because a centred headline will sit across it.",
};

const SPACE: Record<Exclude<TemplateStyle, Layout | "auto">, string> = {
  subtle: "Keep the bottom edge of the frame simple, because a small caption will sit there.",
  bold: "Keep the lower third of the frame calm and softly blurred (simple background, no important details) because a title band will be placed there.",
  minimal: "Keep the lower third of the frame darker and uncluttered because a white title will be placed there.",
  elegant: "Keep the upper third of the frame calm and uncluttered (sky, wall or soft background) because a title card will be placed there.",
  none: "Use the full frame.",
};

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    // Ask for one scene: strip leftover requests for text, numbers or layouts models render badly.
    .replace(/\b(vertical\s+)?2:3\b/gi, "")
    .replace(/,?\s*(with\s+)?(bold\s+)?(number(ed)?\s+(badges|labels|panels)|text overlay space[^,.]*|minimal text[^,.]*)/gi, "")
    .trim();

export function buildImagePrompt({ title, scene, kind, overlay = "auto", angle, palette = "auto", imageStyle }: ImagePromptInput): string {
  const layout: Layout | null =
    overlay === "auto" ? layoutForAngle(angle, title) : (["paper", "framed", "caption", "editorial", "centered"] as string[]).includes(overlay) ? (overlay as Layout) : null;
  const space = layout ? LAYOUT_SPACE[layout] : SPACE[overlay as keyof typeof SPACE];
  const story = palette === "auto" || palette === "brand" ? (layout ? COLOR_STORY[LAYOUT_PALETTE[layout]] : "") : COLOR_STORY[palette];
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
    imageStyle ? `Preferred style for this brand: ${imageStyle.slice(0, 80)}.` : "",
    artDirection(angle, t),
    story,
    "Quality bar: looks like the work of a premium creative agency, luxury editorial aesthetic, polished and intentional, instantly communicates the subject and stops the scroll within two seconds, still reads clearly as a small thumbnail on a phone.",
    "Make it distinctive and original, not a generic stock photo: one unexpected but tasteful detail, a harmonious, restrained colour palette (no harsh or excessive colours) and a single strong focal point.",
    "Composition: a single cohesive scene with one clear focal point, balanced layout with excellent spacing, rule of thirds, generous negative space, depth with a softly blurred background.",
    "Light and finish: soft natural light, gentle shadows, true-to-life skin and fabric textures, rich but natural colours, tack-sharp focus on the subject, high resolution, shot on a full-frame camera with a 50mm lens, magazine-quality retouching.",
    space,
    "Again: no text, letters, words, numbers, captions, headlines, signs, logos, watermarks or signatures; collages, grids, split screens, borders or frames; extra or distorted fingers, hands or faces; clutter, harsh flash, oversaturated colours, heavy gradients, cartoon or CGI look, plastic or artificial-looking skin and objects, blur, awkward cropping, cliché stock-photo poses.",
  ]
    .filter(Boolean)
    .join("\n");
}
