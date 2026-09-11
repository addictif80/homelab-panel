import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Homelab Panel",
    short_name: "Homelab",
    description: "Panneau de contrôle centralisé du homelab",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#3b56d9",
    categories: ["utilities", "productivity"],
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the installed app icon to jump straight into the two things checked most on the
    // go — Android/desktop support this natively; iOS just ignores the field.
    shortcuts: [
      { name: "Sécurité", url: "/security" },
      { name: "Terminal SSH", url: "/ssh" },
    ],
  };
}
