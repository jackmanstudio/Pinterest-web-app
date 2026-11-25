import type { MetadataRoute } from "next";

/** Pages behind sign-in redirect to /login, so crawlers only ever see the public pages. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" } };
}
