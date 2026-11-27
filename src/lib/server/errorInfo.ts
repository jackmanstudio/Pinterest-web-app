/** Pure helpers for error reports (no server imports, so tests can use them). */

export type ErrorSource = "server" | "client" | "api";

export interface ErrorReport {
  id: string;
  source: ErrorSource;
  route: string | null;
  method: string | null;
  status: number | null;
  message: string;
  stack: string | null;
  digest: string | null;
  where: string | null;
  context: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|key|password|authorization|cookie/i;
const SECRET_VALUES = /(Bearer\s+)[\w.\-~+/]+=*|(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)|((?:sk|pk|rk)_(?:live|test)_[\w]+)/g;

/** Short, readable ID such as "ERR-LX4K2P-7Q3M" that users can send with a bug report. */
export function newErrorId(now = Date.now(), rand = Math.random): string {
  const r = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 32)]).join("");
  return `ERR-${now.toString(36).toUpperCase().slice(-6)}-${r}`;
}

export function clip(s: unknown, max: number): string | null {
  if (s === undefined || s === null) return null;
  const text = String(s).replace(SECRET_VALUES, (m, bearer) => (bearer ? `${bearer}[redacted]` : "[redacted]"));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** First stack frame that points into the app's own code: the place to look first. */
export function whereFrom(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const frames = stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at "));
  const own = frames.find((l) => /src[\\/]|webpack-internal|app[\\/]/.test(l) && !/node_modules/.test(l)) ?? frames.find((l) => !/node_modules|node:internal/.test(l));
  return own ? own.replace(/^at\s+/, "").slice(0, 300) : null;
}

export function scrubContext(v: unknown, depth = 0): unknown {
  if (depth > 3 || v === null || typeof v !== "object") return typeof v === "string" ? clip(v, 500) : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubContext(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .slice(0, 30)
      .map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : scrubContext(x, depth + 1)]),
  );
}

export function buildReport(
  err: unknown,
  info: { source?: ErrorSource; route?: string | null; method?: string | null; status?: number | null; digest?: string | null; context?: Record<string, unknown> },
  id = newErrorId(),
): ErrorReport {
  const e = err instanceof Error ? err : null;
  const message = clip(e ? `${e.name !== "Error" ? `${e.name}: ` : ""}${e.message}` : typeof err === "string" ? err : JSON.stringify(err) ?? "Unknown error", 1000) ?? "Unknown error";
  const stack = clip(e?.stack, 4000);
  const digest = info.digest ?? (typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : null);
  const cause = e && "cause" in e && e.cause ? clip(e.cause instanceof Error ? e.cause.message : e.cause, 500) : undefined;
  return {
    id,
    source: info.source ?? "api",
    route: clip(info.route, 300),
    method: clip(info.method, 10),
    status: info.status === undefined ? 500 : info.status,
    message,
    stack,
    digest,
    where: whereFrom(stack),
    context: scrubContext({ ...(info.context ?? {}), ...(cause ? { cause } : {}) }) as Record<string, unknown>,
  };
}
