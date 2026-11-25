import type { Instrumentation } from "next";
import { log } from "@/lib/server/log";

/** Reports every server-side request error as a structured log line. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  log("error", "request_error", {
    message: err instanceof Error ? err.message : String(err),
    digest: typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
