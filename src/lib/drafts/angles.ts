/**
 * Five deliberately different creative angles. Each generation asks for exactly
 * one draft per angle so the five pins differ in intent, not just wording.
 */
export const PIN_ANGLES = [
  {
    key: "how_to",
    label: "How-to / tutorial",
    brief: "A practical step-by-step pin that teaches the viewer to do or recreate something.",
  },
  {
    key: "list",
    label: "List / roundup",
    brief: "A numbered roundup (e.g. '7 ways…') that promises several options in one save.",
  },
  {
    key: "inspiration",
    label: "Inspiration / mood",
    brief: "An aspirational, visual-first pin that sells a feeling or aesthetic, light on instructions.",
  },
  {
    key: "problem_solution",
    label: "Problem → solution",
    brief: "Opens with a specific pain point the audience has, then presents the idea as the fix.",
  },
  {
    key: "seasonal",
    label: "Seasonal / timely",
    brief: "Ties the idea to a season, event or current moment so it feels urgent to save now.",
  },
] as const;

export type PinAngleKey = (typeof PIN_ANGLES)[number]["key"];
