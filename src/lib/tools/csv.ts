import { LIMITS } from "@/lib/drafts/validation";
import type { PinDraft } from "@/lib/types";

/** RFC 4180 CSV parser (quoted fields, "" escapes, CRLF or LF). Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const EXPORT_COLUMNS = [
  "id", "status", "category", "idea", "angle", "title", "description", "tags", "alt_text", "link", "board_name",
  "image_status", "scheduled_for", "published_at", "external_pin_id", "batch_id", "created_at",
] as const;

export function draftsToCsv(drafts: PinDraft[], categoryName: (id: string | null) => string = () => ""): string {
  return toCsv(
    [...EXPORT_COLUMNS],
    drafts.map((d) => EXPORT_COLUMNS.map((c) => (c === "category" ? categoryName(d.category_id) : d[c as keyof PinDraft]))),
  );
}

export const IMPORT_TEMPLATE = toCsv(
  ["idea", "title", "description", "tags", "alt_text", "link", "category"],
  [["Layering a trench coat for autumn", "", "", "trench coat, autumn outfits", "", "https://example.com/trench", "Women's Fashion"]],
);

export interface ImportRow {
  line: number;
  idea: string;
  title: string;
  description: string;
  tags: string[];
  alt_text: string;
  link: string | null;
  category: string;
  errors: string[];
  warnings: string[];
}

export interface ImportReport {
  rows: ImportRow[];
  valid: ImportRow[];
  fatal: string | null;
}

function validUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Validates an idea/pin CSV before anything is saved (spec 24.8): required
 * columns, lengths, duplicate rows and invalid URLs. Rows with errors are
 * skipped; the rest can be imported (partial import).
 */
export function validateImport(text: string, maxRows = 200): ImportReport {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], valid: [], fatal: "The file is empty." };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("idea") < 0 && col("title") < 0) return { rows: [], valid: [], fatal: "The first row must be a header with an “idea” or “title” column." };
  const body = table.slice(1);
  if (body.length > maxRows) return { rows: [], valid: [], fatal: `Too many rows (${body.length}); import at most ${maxRows} at a time.` };
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
  const seen = new Set<string>();
  const rows: ImportRow[] = body.map((r, i) => {
    const title = get(r, "title");
    const idea = get(r, "idea") || title;
    const link = get(r, "link") || get(r, "url");
    const tags = get(r, "tags").split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    const row: ImportRow = {
      line: i + 2,
      idea,
      title: title || idea.slice(0, LIMITS.title),
      description: get(r, "description"),
      tags,
      alt_text: get(r, "alt_text"),
      link: link || null,
      category: get(r, "category"),
      errors: [],
      warnings: [],
    };
    if (idea.length < 3) row.errors.push("Idea/title is missing or too short");
    if (idea.length > LIMITS.idea) row.errors.push(`Idea is over ${LIMITS.idea} characters`);
    if (title.length > LIMITS.title) row.errors.push(`Title is over ${LIMITS.title} characters`);
    if (row.description.length > LIMITS.description) row.errors.push(`Description is over ${LIMITS.description} characters`);
    if (row.alt_text.length > LIMITS.alt_text) row.errors.push(`Alt text is over ${LIMITS.alt_text} characters`);
    if (tags.length > LIMITS.tags) row.warnings.push(`Only the first ${LIMITS.tags} tags are kept`);
    if (link && !validUrl(link)) row.errors.push("Link is not a valid http(s) address");
    if (/�/.test(r.join(""))) row.warnings.push("Some characters could not be read; save the file as UTF-8");
    const key = `${idea.toLowerCase()}|${row.title.toLowerCase()}`;
    if (seen.has(key)) row.errors.push("Duplicate of an earlier row");
    seen.add(key);
    row.tags = tags.slice(0, LIMITS.tags);
    return row;
  });
  return { rows, valid: rows.filter((r) => !r.errors.length), fatal: null };
}
