/**
 * Lets the app keep working when the live database hasn't had the newest
 * migration yet: a query that names a new column or table is retried
 * without it, instead of breaking the whole page.
 */
export interface DbError {
  code?: string;
  message: string;
}

/** Postgres/PostgREST "unknown column" errors. */
export function isMissingColumn(e: DbError | null | undefined): boolean {
  return Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message)));
}

/** Postgres/PostgREST "unknown table" errors. */
export function isMissingTable(e: DbError | null | undefined): boolean {
  return Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(e.message)));
}

export const NEEDS_MIGRATION = "This needs the latest database update. Run supabase/migrations/0008_spec_v18.sql in the Supabase SQL editor.";

export const NEEDS_BOARD_MIGRATION = "Board automation needs a database update. Run supabase/migrations/0009_board_automation.sql in the Supabase SQL editor.";

/** Brand columns added in migration 0008. */
export const BRAND_V8_KEYS = ["image_style", "cta", "language", "region"] as const;
export const BRAND_BASE_COLUMNS = "brand_name, voice, audience, website_url, focus_keywords, banned_words";
