import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ThemeInit from "@/components/ThemeInit";
import AppSplash from "@/components/AppSplash";
import { IOS_SPLASH_DEVICES } from "@/lib/iosSplashDevices";

// One <link rel="apple-touch-startup-image"> per device x orientation x theme, pointing at the
// PNGs scripts/generate-pwa-icons.ts rasterizes into public/splash/ — without these, iOS shows a
// blank white flash on launch instead of this background color while the page loads. Ignored by
// everything that isn't Safari/iOS, so this costs nothing elsewhere.
const startupImages = IOS_SPLASH_DEVICES.flatMap(([name, w, h, ratio]) =>
  (["portrait", "landscape"] as const).flatMap((orientation) => {
    const [mw, mh] = orientation === "portrait" ? [w, h] : [h, w];
    return (["light", "dark"] as const).map((theme) => {
      const suffix = theme === "dark" ? "-dark" : "";
      const colorScheme = theme === "dark" ? "(prefers-color-scheme: dark)" : "(prefers-color-scheme: light)";
      return {
        url: `/splash/${name}-${orientation}${suffix}.png`,
        media: `(device-width: ${mw}px) and (device-height: ${mh}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and ${colorScheme}`,
      };
    });
  })
);

// "SaaS moderne & coloré" direction validated via mockup: Space Grotesk for headings/display
// (characterful, geometric), Plus Jakarta Sans for body (warmer/rounder than a generic grotesk),
// JetBrains Mono for code/terminal/tabular contexts.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Homelab Panel",
  description: "Panneau de contrôle centralisé du homelab",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    // "default" (light bar, dark text) rather than "black-translucent" — the app is light-themed
    // by default, and translucent would render the status bar's own text white over that light
    // surface, right where it's least readable.
    statusBarStyle: "default",
    title: "Homelab",
    startupImage: startupImages,
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4fa" },
    { media: "(prefers-color-scheme: dark)", color: "#100f16" },
  ],
  // viewportFit "cover" lets the standalone app draw under the notch/home-indicator area — the
  // safe-area-inset-* env() values used in AppShell/Sidebar only report non-zero once this is set.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${plusJakartaSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInit />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <AppSplash />
        <ServiceWorkerRegistration />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
