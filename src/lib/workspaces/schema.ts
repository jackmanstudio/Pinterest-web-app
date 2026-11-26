import { z } from "zod";
import { MAX_WORKSPACE_NAME, WORKSPACE_NICHES, WORKSPACE_SLUG_PATTERN } from "@/lib/types";

/** An account slug in a request body or query ("fashion", "my-recipes"). */
export const WorkspaceSlug = z.string().regex(WORKSPACE_SLUG_PATTERN, "Unknown workspace");

export const NewWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(MAX_WORKSPACE_NAME),
  niche: z.enum(WORKSPACE_NICHES).default("macro"),
});
