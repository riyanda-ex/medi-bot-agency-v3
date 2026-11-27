import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MediBot Clinical Operations Platform",
    short_name: "MediBot",
    description:
      "Secure-by-default multi-agent clinical operations platform for Indonesian clinics.",
    start_url: "/login",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0ea5e9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
