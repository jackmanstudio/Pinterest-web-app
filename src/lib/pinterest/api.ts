import type { PinterestConfig } from "./config";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PinterestApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | number | null = null,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "PinterestApiError";
  }
  get isAuth() {
    return this.status === 401;
  }
  get isRateLimited() {
    return this.status === 429;
  }
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  refresh_token_expires_at?: number;
  scope?: string;
}

export interface CreatePinBody {
  board_id: string;
  title?: string;
  description?: string;
  link?: string;
  alt_text?: string;
  media_source: { source_type: "image_base64"; content_type: "image/png" | "image/jpeg"; data: string } | { source_type: "image_url"; url: string };
}

export interface PinterestAccount {
  id?: string;
  username: string;
  account_type?: string;
  profile_image?: string;
}

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string | null;
  privacy?: string;
  pin_count?: number;
}

export interface PinterestPin {
  id: string;
  board_id?: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  alt_text?: string | null;
  created_at?: string;
  media?: { media_type?: string; images?: Record<string, { url?: string; width?: number; height?: number }> };
}

async function toError(res: Response, what: string): Promise<PinterestApiError> {
  let code: string | number | null = null;
  let message = `${what} failed (${res.status})`;
  try {
    const body = (await res.json()) as { code?: number | string; message?: string };
    code = body.code ?? null;
    if (body.message) message = `${what} failed (${res.status}): ${body.message}`;
  } catch {
    /* non-JSON error */
  }
  const ra = Number(res.headers.get("retry-after"));
  return new PinterestApiError(message, res.status, code, Number.isFinite(ra) && ra > 0 ? ra : null);
}

/** Thin, typed Pinterest v5 client. Tokens never leave the server. */
export class PinterestApi {
  constructor(
    private readonly cfg: PinterestConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private basic() {
    return "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
  }

  private async token(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchFn(this.cfg.tokenUrl, {
      method: "POST",
      headers: { Authorization: this.basic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) throw await toError(res, "Pinterest token request");
    return (await res.json()) as TokenResponse;
  }

  exchangeCode(code: string) {
    return this.token({ grant_type: "authorization_code", code, redirect_uri: this.cfg.redirectUri });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async get<T>(accessToken: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
    const u = new URL(this.cfg.apiBase + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const res = await this.fetchFn(u.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!res.ok) throw await toError(res, `GET ${path}`);
    return (await res.json()) as T;
  }

  /** POST /v5/pins — creates a LIVE pin. Only called by the publish runner after approval. */
  async createPin(accessToken: string, body: CreatePinBody): Promise<PinterestPin> {
    const res = await this.fetchFn(this.cfg.apiBase + "/pins", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toError(res, "Create pin");
    return (await res.json()) as PinterestPin;
  }

  account(accessToken: string) {
    return this.get<PinterestAccount>(accessToken, "/user_account");
  }

  /** Follows `bookmark` pagination up to maxPages (page_size max is 250). */
  async paginate<T>(accessToken: string, path: string, maxPages = 20, pageSize = 100): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let bookmark: string | null | undefined;
    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string | number> = { page_size: pageSize };
      if (bookmark) params.bookmark = bookmark;
      const res = await this.get<{ items: T[]; bookmark?: string | null }>(accessToken, path, params);
      items.push(...res.items);
      bookmark = res.bookmark;
      if (!bookmark) return { items, truncated: false };
    }
    return { items, truncated: true };
  }
}

/** Picks the largest available image URL from a pin's media. */
export function pinImageUrl(pin: PinterestPin): string | null {
  const images = pin.media?.images;
  if (!images) return null;
  let best: { url?: string; width?: number } | null = null;
  for (const img of Object.values(images)) if (img?.url && (!best || (img.width ?? 0) > (best.width ?? 0))) best = img;
  return best?.url ?? null;
}
