import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ThemeInit from "@/components/ThemeInit";

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
    statusBarStyle: "black-translucent",
    title: "Homelab",
  },
};

export const viewport = {
  themeColor: "#6d5bfa",
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
        <ServiceWorkerRegistration />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
