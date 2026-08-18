import type { MetadataRoute } from "next";

// Web app manifest — makes StatSeer installable to a phone home screen (PWA), so a
// friends-and-family beta can "Add to Home Screen" and run it full-screen like a
// native app. No app store needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StatSeer",
    short_name: "StatSeer",
    description:
      "Betting analysis you can actually check — calibrated line-blind predictions, a value finder, and honest game context.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c2b1c",
    theme_color: "#0c2b1c",
    icons: [
      { src: "/icon-192.png?v=7", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=7", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png?v=7", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
