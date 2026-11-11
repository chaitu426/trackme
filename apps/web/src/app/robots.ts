import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/brand";

/** The public pages are the landing page, sign-in and the legal pages. The app, the API and invitations are not for crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/onboarding", "/invite/", "/share/"] }],
    sitemap: `${appOrigin()}/sitemap.xml`,
  };
}
