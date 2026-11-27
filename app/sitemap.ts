import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return [
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 }
  ];
}
