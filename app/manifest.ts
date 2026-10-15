import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rulerz — AI chat assistant",
    short_name: "Rulerz",
    description: "Chat with free AI models. Pick a persona and a response language.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef2ee",
    theme_color: "#0f6b5a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
