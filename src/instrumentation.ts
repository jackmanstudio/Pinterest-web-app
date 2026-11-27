import type { Instrumentation } from "next";
import { log } from "@/lib/server/log";

/** Reports every uncaught server-side request error to the error log (with an error ID). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const info = {
    source: "server" as const,
    route: request.path,
    method: request.method,
    status: 500,
    context: { routePath: context.routePath, routeType: context.routeType, renderSource: "renderSource" in context ? context.renderSource : undefined },
  };
  try {
    const { reportError } = await import("@/lib/server/errors");
    await reportError(err, info);
  } catch (e) {
    log("error", "request_error", { ...info, message: err instanceof Error ? err.message : String(err), reportFailed: e instanceof Error ? e.message : String(e) });
  }
};
