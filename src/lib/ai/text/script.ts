/**
 * Models sometimes drop letters or marks from another writing system into the
 * text (Chinese 服 or Devanagari ्/ी inside Urdu), or leave an English sentence
 * in a translated description. Each language allows its own script plus Latin
 * (brand names); combining marks must belong to that script too.
 */
const SCRIPTS: Record<string, RegExp> = {
  urdu: /\p{Script=Arabic}/u,
  arabic: /\p{Script=Arabic}/u,
  hindi: /\p{Script=Devanagari}/u,
};
const LATIN = /\p{Script=Latin}/u;
const INHERITED = /\p{Script=Inherited}/u;
/** Letters and combining marks (a stray Devanagari vowel sign is a mark, not a letter). */
const GLYPH = /[\p{L}\p{M}]/gu;

const langKey = (language?: string | null) => (language ?? "").trim().toLowerCase();

function allowed(language: string | null | undefined): (ch: string) => boolean {
  const own = SCRIPTS[langKey(language)];
  return (ch) => LATIN.test(ch) || INHERITED.test(ch) || (own ? own.test(ch) : false);
}

/** Letters or marks that don't belong to the language's script (empty when clean). */
export function strayLetters(text: string, language?: string | null): string[] {
  const ok = allowed(language);
  return (text.match(GLYPH) ?? []).filter((ch) => !ok(ch));
}

/** A localized "save this pin" line for languages with their own script. */
export const LOCAL_CTA: Record<string, string> = {
  urdu: "اسے بعد کے لیے سیو کر لیں۔",
  arabic: "احفظ هذا الدبوس للرجوع إليه لاحقًا.",
  hindi: "इसे बाद के लिए सेव करें।",
};
const ENGLISH_CTA = /\b(save|pin) (this|it)( pin)?( for later| now)?\b[^.!?]*[.!?]?|\bsave for later[.!?]?/gi;

/**
 * Drops whole words that contain stray characters (half-removed words read as
 * garbage), and in non-Latin languages swaps an English "Save this pin…" line
 * for the local one and removes other English sentences.
 */
export function stripStray(text: string, language?: string | null, opts: { description?: boolean } = {}): string {
  const ok = allowed(language);
  const key = langKey(language);
  let out = text
    .split(/(\s+)/)
    // A broken word goes, but punctuation after it (e.g. the title's colon) stays.
    .map((tok) => (/^\s+$/.test(tok) || !(tok.match(GLYPH) ?? []).some((ch) => !ok(ch)) ? tok : (tok.match(/[:،,.!?؟۔]+$/)?.[0] ?? "")))
    .join("");
  if (SCRIPTS[key]) {
    let hadCta = false;
    out = out.replace(ENGLISH_CTA, () => {
      hadCta = true;
      return "";
    });
    // Whole English sentences (3+ Latin words) don't belong in an Urdu/Arabic/Hindi description.
    if (opts.description) out = out.replace(/(?:^|(?<=[.!?۔؟]\s*))(?:[A-Za-z][\w'’-]*[\s,]+){2,}[A-Za-z][\w'’-]*[.!?]?/g, "");
    if (hadCta && opts.description && LOCAL_CTA[key] && !out.includes(LOCAL_CTA[key])) out = `${out.trim()} ${LOCAL_CTA[key]}`;
  }
  return out
    .replace(/#(?=\s|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([:،,.!?؟۔])/g, "$1")
    .replace(/^[\s:،,.]+/, "")
    .trim();
}

type Copy = { title: string; description: string; tags: string[]; alt_text: string };
const fields = (d: Copy) => [d.title, d.description, d.alt_text, ...d.tags].join(" ");

export function draftsHaveStray(drafts: Copy[], language?: string | null): boolean {
  const key = langKey(language);
  return drafts.some((d) => strayLetters(fields(d), language).length > 0 || (Boolean(SCRIPTS[key]) && ENGLISH_CTA.test(d.description) && !(ENGLISH_CTA.lastIndex = 0)));
}

export function cleanDrafts<T extends Copy>(drafts: T[], language?: string | null): T[] {
  return drafts.map((d) => ({
    ...d,
    title: stripStray(d.title, language),
    description: stripStray(d.description, language, { description: true }),
    alt_text: stripStray(d.alt_text, language),
    tags: d.tags.map((t) => stripStray(t, language)).filter(Boolean),
  }));
}
