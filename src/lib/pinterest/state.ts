import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** OAuth `state` payload kept in a signed, httpOnly cookie for CSRF protection. */
export interface OAuthState {
  state: string;
  workspace: string;
  uid: string;
  exp: number;
}

export const STATE_COOKIE = "pin_oauth_state";
export const STATE_TTL_SEC = 600;

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function createState(workspace: string, uid: string, secret: string, now = Date.now()): { state: string; cookie: string } {
  const payload: OAuthState = { state: randomBytes(24).toString("base64url"), workspace, uid, exp: now + STATE_TTL_SEC * 1000 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: payload.state, cookie: `${data}.${sign(data, secret)}` };
}

/** Returns the payload only if the cookie is authentic, unexpired, and matches the returned state and user. */
export function verifyState(cookie: string | undefined, returnedState: string | null, uid: string, secret: string, now = Date.now()): OAuthState | null {
  if (!cookie || !returnedState) return null;
  const [data, sig] = cookie.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: OAuthState;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.exp < now || payload.uid !== uid) return null;
  const a = Buffer.from(payload.state);
  const b = Buffer.from(returnedState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}
