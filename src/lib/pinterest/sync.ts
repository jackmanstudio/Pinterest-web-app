import { PinterestApiError, type PinterestApi, type PinterestBoard, type PinterestPin, type TokenResponse } from "./api";

/** Refresh when the access token expires within this window. */
export const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

export function needsRefresh(accessExpiresAt: string, now = Date.now()): boolean {
  return new Date(accessExpiresAt).getTime() - now < REFRESH_WINDOW_MS;
}

export interface TokenStore {
  access_token: string;
  refresh_token: string | null;
  access_expires_at: string;
  refresh_expires_at: string | null;
}

export class ReconnectRequired extends Error {}

/** Returns a usable access token, refreshing it first when close to expiry. */
export async function ensureAccessToken(
  api: Pick<PinterestApi, "refresh">,
  conn: TokenStore,
  onRefreshed: (t: TokenResponse) => Promise<void>,
  now = Date.now(),
): Promise<string> {
  if (!needsRefresh(conn.access_expires_at, now)) return conn.access_token;
  if (!conn.refresh_token || (conn.refresh_expires_at && new Date(conn.refresh_expires_at).getTime() <= now)) {
    if (new Date(conn.access_expires_at).getTime() > now) return conn.access_token;
    throw new ReconnectRequired("Pinterest access expired. Please reconnect.");
  }
  try {
    const t = await api.refresh(conn.refresh_token);
    await onRefreshed(t);
    return t.access_token;
  } catch (err) {
    if (err instanceof PinterestApiError && (err.status === 400 || err.status === 401)) {
      throw new ReconnectRequired("Pinterest refused the saved login. Please reconnect.");
    }
    throw err;
  }
}

export interface SyncResult {
  boards: PinterestBoard[];
  pins: PinterestPin[];
  truncated: boolean;
}

/** Read-only sync of the connected account's boards and pins. */
export async function fetchBoardsAndPins(api: Pick<PinterestApi, "paginate">, accessToken: string, maxPages = 20): Promise<SyncResult> {
  const boards = await api.paginate<PinterestBoard>(accessToken, "/boards", maxPages);
  const pins = await api.paginate<PinterestPin>(accessToken, "/pins", maxPages);
  return { boards: boards.items, pins: pins.items, truncated: boards.truncated || pins.truncated };
}

/** Plain-language message for a Pinterest error, safe to show the user. */
export function describePinterestError(err: unknown): string {
  if (err instanceof ReconnectRequired) return err.message;
  if (err instanceof PinterestApiError) {
    if (err.status === 401) return "Pinterest says the login is no longer valid. Please reconnect.";
    if (err.status === 429) return `Pinterest rate limit reached. Try again${err.retryAfterSec ? ` in ${err.retryAfterSec}s` : " later"}.`;
    if (err.status === 403) {
      return String(err.code).includes("PINNER_DATA_ACCESS_DENIED") || err.message.includes("PINNER_DATA_ACCESS_DENIED")
        ? "Pinterest denied access to this account's boards/pins. New apps may only read business accounts until Pinterest approves access."
        : "Pinterest denied this request. Check the app's access tier and granted scopes.";
    }
    if (err.status >= 500) return "Pinterest is having problems right now. Try again later.";
    return err.message;
  }
  return "Unexpected error while talking to Pinterest.";
}
