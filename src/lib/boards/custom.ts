import { boardNameKey, findBoardByName, type Board } from "./automation";

/**
 * Boards the user typed in the board picker. Until Pinterest is connected
 * they are kept in this browser only (id "local:<key>"), so a pin can be
 * planned for them; publishing needs the board to exist on Pinterest first.
 */
export const LOCAL_BOARD_PREFIX = "local:";

export const isLocalBoard = (id: string | null | undefined): boolean => Boolean(id && id.startsWith(LOCAL_BOARD_PREFIX));

/** Trims, collapses spaces, and caps at Pinterest's 50-character board name limit. */
export function cleanBoardName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 50);
}

export type NewBoardCheck = { ok: true; name: string } | { ok: false; error: string; existing?: Board };

/** Validates a typed board name against the boards already in the picker. */
export function checkNewBoardName(name: string, boards: Board[]): NewBoardCheck {
  const clean = cleanBoardName(name);
  if (!clean || !boardNameKey(clean)) return { ok: false, error: "Type a board name (letters or numbers)." };
  const dup = findBoardByName(boards, clean);
  if (dup) return { ok: false, error: `“${dup.name}” is already in the list, so it was picked for you.`, existing: dup };
  return { ok: true, name: clean };
}

export function localBoard(name: string): Board {
  const clean = cleanBoardName(name);
  return { board_id: `${LOCAL_BOARD_PREFIX}${boardNameKey(clean)}`, name: clean, description: null, privacy: "PUBLIC" };
}

/** Real boards first, then the user's local boards whose names aren't on Pinterest yet. */
export function mergeBoards(real: Board[], local: Board[]): Board[] {
  return [...real, ...local.filter((b) => !findBoardByName(real, b.name))];
}

const storageKey = (kind: string) => `pin-ai-studio:custom-boards:${kind}`;

export function loadLocalBoards(kind: string): Board[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(kind)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((b) => typeof b?.name === "string").map((b) => localBoard(b.name)) : [];
  } catch {
    return [];
  }
}

export function saveLocalBoards(kind: string, boards: Board[]): void {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(boards.map((b) => ({ name: b.name }))));
  } catch {
    // Private mode or storage blocked: the board still works for this visit.
  }
}
