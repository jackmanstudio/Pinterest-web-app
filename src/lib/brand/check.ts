import type { DesignMeta } from "./template";

export interface PhotoStats {
  /** Laplacian standard deviation of a 400px-wide greyscale copy: higher = sharper. */
  sharpness: number;
  /** Mean brightness 0-1. */
  brightness: number;
  /** Mean HSL saturation 0-1. */
  saturation: number;
  /** Share of pixels that are blown-out white or crushed black. */
  clipped: number;
}

export interface DesignCheck {
  id: "sharp" | "exposure" | "colour" | "readable" | "contrast" | "variety" | "eye";
  question: string;
  status: "pass" | "warn" | "fail" | "manual";
  detail: string;
}

export interface DesignReport {
  score: number;
  layout: string;
  palette: string;
  checks: DesignCheck[];
  /** True when the photo itself is weak (blurry or badly exposed), so a new image is worth making. */
  retryPhoto: boolean;
}

/**
 * The pin self-check from the design guide ("Professional finishing").
 * Measurable items are scored; taste questions are listed for a human look.
 */
export function designReport(photo: PhotoStats | null, meta: DesignMeta | null, opts: { paletteName?: string } = {}): DesignReport {
  const checks: DesignCheck[] = [];
  if (photo) {
    checks.push(
      photo.sharpness >= 7
        ? { id: "sharp", question: "Does the image look sharp and professional?", status: "pass", detail: "The photo is crisp." }
        : photo.sharpness >= 4
          ? { id: "sharp", question: "Does the image look sharp and professional?", status: "warn", detail: "The photo is a little soft." }
          : { id: "sharp", question: "Does the image look sharp and professional?", status: "fail", detail: "The photo looks blurry." },
    );
    const exposureOk = photo.brightness >= 0.14 && photo.brightness <= 0.88 && photo.clipped < 0.18;
    checks.push({
      id: "exposure",
      question: "Is the photo well lit?",
      status: exposureOk ? "pass" : photo.clipped > 0.35 || photo.brightness < 0.08 || photo.brightness > 0.95 ? "fail" : "warn",
      detail: exposureOk ? "Balanced light." : photo.brightness < 0.14 ? "The photo is very dark." : photo.brightness > 0.88 ? "The photo is very bright." : "Parts of the photo are blown out or crushed.",
    });
    checks.push({
      id: "colour",
      question: "Are the colours harmonious?",
      status: photo.saturation <= 0.55 ? "pass" : photo.saturation <= 0.7 ? "warn" : "fail",
      detail: photo.saturation <= 0.55 ? "Calm, restrained colours." : "Colours are very saturated; a softer palette looks more premium.",
    });
  }
  if (meta) {
    checks.push({
      id: "readable",
      question: "Is the headline readable on mobile?",
      status: meta.headlineSize >= 50 && meta.lines <= 3 ? "pass" : meta.headlineSize >= 44 ? "warn" : "fail",
      detail: `Headline at ${Math.round(meta.headlineSize)}px on ${meta.lines} line${meta.lines === 1 ? "" : "s"} (about ${Math.round(meta.headlineSize * 0.236)}px on a phone thumbnail).`,
    });
    checks.push({
      id: "contrast",
      question: "Does the headline stand out from the background?",
      status: meta.contrast >= 4.5 ? "pass" : meta.contrast >= 3 ? "warn" : "fail",
      detail: `Estimated contrast ${meta.contrast.toFixed(1)}:1 (4.5:1 or more is easy to read).`,
    });
    checks.push({ id: "variety", question: "Is the layout different from the other pins?", status: "pass", detail: `Layout: ${meta.layout}, palette: ${opts.paletteName ?? "custom"}.` });
  }
  checks.push({
    id: "eye",
    question: "Would someone stop scrolling, and is the message clear?",
    status: "manual",
    detail: "Taste can't be measured by code. Have a quick look; regenerate if it feels ordinary.",
  });
  const lost = checks.reduce((n, c) => n + (c.status === "fail" ? 25 : c.status === "warn" ? 10 : 0), 0);
  return {
    score: Math.max(0, 100 - lost),
    layout: meta?.layout ?? "classic",
    palette: opts.paletteName ?? "",
    checks,
    retryPhoto: checks.some((c) => (c.id === "sharp" || c.id === "exposure") && c.status === "fail"),
  };
}
