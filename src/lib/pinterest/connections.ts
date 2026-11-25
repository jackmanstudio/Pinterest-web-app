import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import type { PinterestAccount, PinterestBoard, PinterestPin, TokenResponse } from "./api";
import { pinImageUrl } from "./api";
import type { PinterestEnv } from "./config";

/** Connection details that are safe to send to the browser (no tokens). */
export interface ConnectionInfo {
  environment: PinterestEnv;
  username: string;
  account_type: string | null;
  profile_image: string | null;
  scopes: string[];
  status: "active" | "needs_reconnect";
  access_expires_at: string;
  refresh_expires_at: string | null;
  sync_status: "never" | "running" | "ok" | "error";
  sync_error: string | null;
  last_synced_at: string | null;
  connected_at: string;
}

export interface StoredConnection extends ConnectionInfo {
  workspace_id: string;
  access_token: string;
  refresh_token: string | null;
  sync_started_at: string | null;
}

const SAFE_COLUMNS =
  "environment, username, account_type, profile_image, scopes, status, access_expires_at, refresh_expires_at, sync_status, sync_error, last_synced_at, connected_at";

export function tokenExpiries(t: TokenResponse, now = Date.now()) {
  const access = new Date(now + t.expires_in * 1000).toISOString();
  const refresh = t.refresh_token_expires_at
    ? new Date(t.refresh_token_expires_at * 1000).toISOString()
    : t.refresh_token_expires_in
      ? new Date(now + t.refresh_token_expires_in * 1000).toISOString()
      : null;
  return { access, refresh };
}

/** Server-only persistence for Pinterest connections and synced data. */
export class ConnectionRepo {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly encryptionKey: string,
  ) {}

  async info(workspaceId: string): Promise<ConnectionInfo | null> {
    const { data, error } = await this.admin.from("pinterest_connections").select(SAFE_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ConnectionInfo | null) ?? null;
  }

  async get(workspaceId: string): Promise<StoredConnection | null> {
    const { data, error } = await this.admin
      .from("pinterest_connections")
      .select(`${SAFE_COLUMNS}, workspace_id, access_token_enc, refresh_token_enc, sync_started_at`)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { access_token_enc, refresh_token_enc, ...rest } = data as Record<string, unknown> & { access_token_enc: string; refresh_token_enc: string | null };
    return {
      ...(rest as unknown as Omit<StoredConnection, "access_token" | "refresh_token">),
      access_token: decryptToken(access_token_enc, this.encryptionKey),
      refresh_token: refresh_token_enc ? decryptToken(refresh_token_enc, this.encryptionKey) : null,
    };
  }

  async save(workspaceId: string, env: PinterestEnv, tokens: TokenResponse, account: PinterestAccount, requestedScopes: string[]) {
    const exp = tokenExpiries(tokens);
    const row = {
      workspace_id: workspaceId,
      environment: env,
      pinterest_user_id: account.id ?? null,
      username: account.username,
      account_type: account.account_type ?? null,
      profile_image: account.profile_image ?? null,
      // Record what Pinterest actually granted; fall back to what we asked for.
      scopes: tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : requestedScopes,
      access_token_enc: encryptToken(tokens.access_token, this.encryptionKey),
      refresh_token_enc: tokens.refresh_token ? encryptToken(tokens.refresh_token, this.encryptionKey) : null,
      access_expires_at: exp.access,
      refresh_expires_at: exp.refresh,
      status: "active",
      connected_at: new Date().toISOString(),
    };
    const { error } = await this.admin.from("pinterest_connections").upsert(row);
    if (error) throw new Error(error.message);
  }

  async updateTokens(workspaceId: string, tokens: TokenResponse, previousRefresh: string | null) {
    const exp = tokenExpiries(tokens);
    const patch: Record<string, unknown> = {
      access_token_enc: encryptToken(tokens.access_token, this.encryptionKey),
      access_expires_at: exp.access,
      status: "active",
    };
    // Continuous refresh returns a new refresh token; keep the old one otherwise.
    if (tokens.refresh_token && tokens.refresh_token !== previousRefresh) {
      patch.refresh_token_enc = encryptToken(tokens.refresh_token, this.encryptionKey);
      if (exp.refresh) patch.refresh_expires_at = exp.refresh;
    }
    const { error } = await this.admin.from("pinterest_connections").update(patch).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
  }

  async markNeedsReconnect(workspaceId: string, reason: string) {
    await this.admin.from("pinterest_connections").update({ status: "needs_reconnect", sync_status: "error", sync_error: reason }).eq("workspace_id", workspaceId);
  }

  /** Atomically claims the sync slot. Returns false if a recent sync is still running. */
  async beginSync(workspaceId: string, staleAfterMs = 10 * 60_000): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
    const { data, error } = await this.admin
      .from("pinterest_connections")
      .update({ sync_status: "running", sync_started_at: now.toISOString(), sync_error: null })
      .eq("workspace_id", workspaceId)
      .or(`sync_status.neq.running,sync_started_at.lt.${staleBefore}`)
      .select("workspace_id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async finishSync(workspaceId: string, result: { ok: true } | { ok: false; error: string }) {
    await this.admin
      .from("pinterest_connections")
      .update(result.ok ? { sync_status: "ok", sync_error: null, last_synced_at: new Date().toISOString() } : { sync_status: "error", sync_error: result.error.slice(0, 500) })
      .eq("workspace_id", workspaceId);
  }

  /** Upserts synced rows; prunes stale rows only after a complete (untruncated) sync. */
  async replaceSyncedData(workspaceId: string, boards: PinterestBoard[], pins: PinterestPin[], prune: boolean) {
    const now = new Date().toISOString();
    const b = boards.map((x) => ({
      workspace_id: workspaceId, board_id: x.id, name: x.name, description: x.description ?? null, privacy: x.privacy ?? null, pin_count: x.pin_count ?? null, synced_at: now,
    }));
    const p = pins.map((x) => ({
      workspace_id: workspaceId, pin_id: x.id, board_id: x.board_id ?? null, title: x.title ?? null, description: x.description ?? null, link: x.link ?? null,
      alt_text: x.alt_text ?? null, image_url: pinImageUrl(x), pin_created_at: x.created_at ?? null, synced_at: now,
    }));
    await this.upsertAndPrune("pinterest_boards", b, "workspace_id,board_id", workspaceId, now, prune);
    await this.upsertAndPrune("pinterest_pins", p, "workspace_id,pin_id", workspaceId, now, prune);
  }

  private async upsertAndPrune(table: string, rows: Record<string, unknown>[], key: string, workspaceId: string, now: string, prune: boolean) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.admin.from(table).upsert(rows.slice(i, i + 500), { onConflict: key });
      if (error) throw new Error(error.message);
    }
    if (!prune) return;
    // Drop rows that no longer exist on Pinterest (not seen in this full sync).
    const { error } = await this.admin.from(table).delete().eq("workspace_id", workspaceId).lt("synced_at", now);
    if (error) throw new Error(error.message);
  }

  async disconnect(workspaceId: string) {
    for (const table of ["pinterest_pins", "pinterest_boards", "pinterest_connections"]) {
      const { error } = await this.admin.from(table).delete().eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    }
  }
}
