import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ThemeInit from "@/components/ThemeInit";

// "Minimal épuré" (Linear/Vercel) direction validated via mockup: Instrument Sans for both body
// and headings (display font dropped — one typeface, weight does the work), JetBrains Mono for
// code/terminal/tabular contexts.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
  themeColor: "#4f46e5",
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
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
