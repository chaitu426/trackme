import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  return ["/", "/login", "/signup", "/legal/privacy"].map((path) => ({ url: `${origin}${path}`, changeFrequency: "monthly", priority: path === "/" ? 1 : 0.5 }));
}
