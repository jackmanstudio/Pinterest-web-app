import { PIN_ANGLES, type PinAngleKey } from "@/lib/drafts/angles";
import { LIMITS } from "@/lib/drafts/validation";
import type { DraftContent, GenerateRequest, GenerateResponse } from "@/lib/types";
import type { TextProvider } from "./types";

/**
 * Template-based stand-in used when no TEXT_AI_API_KEY is configured.
 * Output is always returned with source "demo" so the UI labels it.
 */
export class DemoTextProvider implements TextProvider {
  readonly name = "Demo templates (no AI)";
  readonly source = "demo" as const;

  async generateDrafts(req: GenerateRequest): Promise<GenerateResponse> {
    return {
      source: "demo",
      provider: this.name,
      model: null,
      drafts: PIN_ANGLES.map((a) => demoDraft(a.key, a.label, req)),
    };
  }
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function demoDraft(key: PinAngleKey, label: string, req: GenerateRequest): DraftContent {
  const idea = req.idea.trim();
  // Keep the idea short in titles so the angle-specific wording always fits.
  const Idea = titleCase(clip(idea.split(/\s+/).slice(0, 6).join(" "), 40));
  const brand = req.brand.brand_name || "our studio";
  const audience = req.brand.audience || "anyone who loves this look";
  const cat = req.category ? ` (${req.category})` : "";
  const season = currentSeason();

  const byAngle: Record<PinAngleKey, Omit<DraftContent, "angle" | "tags">> = {
    how_to: {
      concept: `Step-by-step guide showing how to recreate "${idea}" at home${cat}.`,
      title: `How to Get the ${Idea} Look in 4 Easy Steps`,
      description: `Save this step-by-step guide to ${idea}. We break it into four simple steps ${audience} can follow today, with the small details that make the difference. More guides from ${brand}.`,
      alt_text: `Four-panel step-by-step collage demonstrating ${idea}, numbered 1 to 4.`,
      image_prompt: `Overhead styled flat lay of everything needed for ${idea}, neatly arranged on a light linen surface, soft natural window light.`,
    },
    list: {
      concept: `A numbered roundup of 7 variations on "${idea}".`,
      title: `7 ${Idea} Ideas Worth Saving Right Now`,
      description: `Seven fresh takes on ${idea}, from easy everyday options to standout statement versions. Pick your favourite and pin the rest for later. Curated by ${brand}.`,
      alt_text: `Grid of seven different variations of ${idea} with number labels.`,
      image_prompt: `A stylish person showcasing ${idea} on a sunlit city street, full-length shot, confident relaxed pose, cohesive neutral palette.`,
    },
    inspiration: {
      concept: `Mood-led hero image that sells the feeling of "${idea}".`,
      title: `${Idea}: Pure Everyday Inspiration`,
      description: `Let this be your sign to try ${idea}. A calm, aspirational take for ${audience}, made to inspire your next board. Explore more moods from ${brand}.`,
      alt_text: `Atmospheric single hero photo capturing the mood of ${idea}.`,
      image_prompt: `Cinematic hero shot evoking ${idea}, shallow depth of field, warm golden-hour tones, calm and aspirational mood.`,
    },
    problem_solution: {
      concept: `Names a common frustration, then shows "${idea}" as the fix.`,
      title: `Stuck in a Rut? ${Idea} Is the Easy Fix`,
      description: `If you keep running into the same problem, ${idea} might be exactly what you need. Here is why it works and how to start without overthinking it. Tips from ${brand}.`,
      alt_text: `Before-and-after split image showing the change ${idea} makes.`,
      image_prompt: `Close-up detail shot of ${idea}, showing texture and craftsmanship, bright and fresh, clean background.`,
    },
    seasonal: {
      concept: `Frames "${idea}" as a must-try for ${season}.`,
      title: `${Idea} for ${titleCase(season)}: Save It Before It's Gone`,
      description: `${titleCase(season)} is the perfect moment for ${idea}. Pin this now so it is ready when you need it, and check back for more seasonal picks from ${brand}.`,
      alt_text: `Seasonal ${season} scene featuring ${idea} with themed props.`,
      image_prompt: `A cosy ${season} lifestyle scene centred on ${idea}, seasonal props and colours, warm editorial styling.`,
    },
  };

  const base = byAngle[key];
  const tags = [
    ...idea.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 3),
    key.replace("_", " "),
    ...req.brand.focus_keywords.slice(0, 3),
    req.workspace,
  ];
  return {
    angle: label,
    concept: base.concept,
    title: clip(base.title, LIMITS.title),
    description: clip(base.description, LIMITS.description),
    alt_text: clip(base.alt_text, LIMITS.alt_text),
    image_prompt: base.image_prompt,
    tags: [...new Set(tags)].slice(0, LIMITS.tags),
  };
}

function currentSeason(d = new Date()): string {
  const m = d.getMonth();
  return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "autumn";
}
