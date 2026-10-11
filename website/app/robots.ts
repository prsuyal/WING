import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  // Local demo has no search-indexing requirement; private routes stay excluded.
  return { rules: { userAgent: "*", disallow: "/" } };
}
