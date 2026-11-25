/**
 * Standard spellings of festivals and culture words that models often
 * transliterate by sound (e.g. "Eid" as ایڈی, "Eddie"). Used in the prompt and
 * to correct the output afterwards.
 */
interface Term { en: RegExp; native: string; wrong: string[] }

const GLOSSARY: Record<string, Term[]> = {
  urdu: [
    { en: /\beid\b/i, native: "عید", wrong: ["ایڈی", "ایڈ", "ائید", "ایید", "اید"] },
    { en: /\bramadan|ramzan\b/i, native: "رمضان", wrong: ["رامادان", "رماڈان", "رامضان"] },
    { en: /\biftar\b/i, native: "افطار", wrong: ["افتار"] },
    { en: /\bmehndi|mehendi|henna\b/i, native: "مہندی", wrong: ["مہندہ", "منہدی"] },
    { en: /\babaya\b/i, native: "عبایا", wrong: ["اباية", "ابایا"] },
    { en: /\bhijab\b/i, native: "حجاب", wrong: ["ہجاب", "حیجاب"] },
    { en: /\bdupatta\b/i, native: "دوپٹہ", wrong: ["ڈوپٹہ", "دوپٹا"] },
    { en: /\bkameez|shalwar|salwar\b/i, native: "شلوار قمیض", wrong: ["سلوار قمیض", "شلوار کمیز"] },
    { en: /\bwedding|shaadi|shadi\b/i, native: "شادی", wrong: ["ویڈنگ"] },
  ],
  arabic: [
    { en: /\beid\b/i, native: "عيد", wrong: ["إيد", "ايد"] },
    { en: /\bramadan\b/i, native: "رمضان", wrong: ["رامادان"] },
  ],
  hindi: [
    { en: /\beid\b/i, native: "ईद", wrong: ["एड", "ईड"] },
    { en: /\bdiwali|deepavali\b/i, native: "दिवाली", wrong: ["डिवाली"] },
    { en: /\bholi\b/i, native: "होली", wrong: ["होलि"] },
  ],
};

const key = (language?: string | null) => (language ?? "").trim().toLowerCase();

/** Prompt line with the standard spelling of terms that appear in the idea. */
export function glossaryHint(language: string | undefined | null, text: string): string {
  const terms = (GLOSSARY[key(language)] ?? []).filter((t) => t.en.test(text));
  if (!terms.length) return "";
  return `Spell these words in their standard ${language} form, never by sound: ${terms.map((t) => `${t.en.source.replace(/\\b/g, "").replace(/\|/g, "/")} = ${t.native}`).join("; ")}.\n`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces known wrong spellings with the standard one (whole words only). */
export function fixSpelling(text: string, language: string | undefined | null): string {
  let out = text;
  for (const t of GLOSSARY[key(language)] ?? []) {
    for (const w of t.wrong) {
      out = out.replace(new RegExp(`(^|[\\s#،,.!؟?:;()«»"'\\-])${esc(w)}(?=$|[\\s،,.!؟?:;()«»"'\\-])`, "gu"), `$1${t.native}`);
    }
  }
  return out;
}

export function fixDraftSpelling<T extends { title: string; description: string; tags: string[]; alt_text: string }>(drafts: T[], language: string | undefined | null): T[] {
  if (!GLOSSARY[key(language)]) return drafts;
  return drafts.map((d) => ({
    ...d,
    title: fixSpelling(d.title, language),
    description: fixSpelling(d.description, language),
    alt_text: fixSpelling(d.alt_text, language),
    tags: d.tags.map((t) => fixSpelling(t, language)),
  }));
}
