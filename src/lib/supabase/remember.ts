/**
 * "Remember me": when it's off, Supabase session cookies are written without
 * a max-age, so the browser drops them when it closes. The choice itself is
 * kept in a small, non-secret cookie that the server and browser both read.
 */
export const REMEMBER_COOKIE = "pas_remember";

export function readRemember(getCookie: (name: string) => string | undefined): boolean {
  return getCookie(REMEMBER_COOKIE) !== "0";
}

/** Strips max-age/expires from session cookies when "remember me" is off (removals keep maxAge 0). */
export function rememberOptions<T extends { maxAge?: number; expires?: Date | number | string }>(options: T | undefined, remember: boolean): T | undefined {
  if (remember || !options || options.maxAge === 0) return options;
  const { maxAge: _m, expires: _e, ...rest } = options;
  void _m;
  void _e;
  return rest as T;
}
