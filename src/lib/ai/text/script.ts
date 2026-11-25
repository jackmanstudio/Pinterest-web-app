/**
 * Models sometimes drop a word from another writing system into the text
 * (e.g. Chinese 服 inside Urdu). Each language allows its own script plus
 * Latin (brand names, numbers); any other letter is stray.
 */
const SCRIPTS: Record<string, RegExp> = {
  urdu: /\p{Script=Arabic}/u,
  arabic: /\p{Script=Arabic}/u,
  hindi: /\p{Script=Devanagari}/u,
};
const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}/gu;

function allowed(language: string | null | undefined): (ch: string) => boolean {
  const own = SCRIPTS[(language ?? "").trim().toLowerCase()];
  return (ch) => LATIN.test(ch) || (own ? own.test(ch) : false);
}

/** Letters that don't belong to the language's script (empty when clean). */
export function strayLetters(text: string, language?: string | null): string[] {
  const ok = allowed(language);
  return (text.match(LETTER) ?? []).filter((ch) => !ok(ch));
}

/** Removes stray letters and tidies the spacing they leave behind. */
export function stripStray(text: string, language?: string | null): string {
  const ok = allowed(language);
  return text
    .replace(LETTER, (ch) => (ok(ch) ? ch : ""))
    .replace(/#(?=\s|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([:،,.!?؟])/g, "$1")
    .trim();
}

type Copy = { title: string; description: string; tags: string[]; alt_text: string };
const fields = (d: Copy) => [d.title, d.description, d.alt_text, ...d.tags].join(" ");

export function draftsHaveStray(drafts: Copy[], language?: string | null): boolean {
  return drafts.some((d) => strayLetters(fields(d), language).length > 0);
}

export function cleanDrafts<T extends Copy>(drafts: T[], language?: string | null): T[] {
  return drafts.map((d) => ({
    ...d,
    title: stripStray(d.title, language),
    description: stripStray(d.description, language),
    alt_text: stripStray(d.alt_text, language),
    tags: d.tags.map((t) => stripStray(t, language)).filter(Boolean),
  }));
}
