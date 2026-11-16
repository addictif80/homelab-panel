#!/usr/bin/env -S npx tsx
/**
 * Regenerates the PWA icons and the iOS launch screens (apple-touch-startup-image) from
 * public/icon.svg — rerun this any time the logo or the splash colors change. Mirrors the same
 * technique as addictif80/familyboard's scripts/generate-pwa-icons.js (per-device/orientation/
 * theme screenshots of a tiny HTML page), but drives the Chromium this panel already knows how
 * to find (lib/screenshot.ts's findChromiumExecutable, same binary the service-link screenshots
 * and the embedded browser use) via puppeteer-core — no new dependency, and it works on the
 * user's own server the same way it works here.
 *
 * Usage: npx tsx scripts/generate-pwa-icons.ts
 *
 * Produces:
 *  - public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
 *  - public/splash/<device>-<orientation>.png        (light)
 *  - public/splash/<device>-<orientation>-dark.png    (dark)
 *
 * Keep in sync with:
 *  - src/app/manifest.ts (icons, background_color/theme_color)
 *  - src/app/layout.tsx (the generated apple-touch-startup-image list, SPLASH_DEVICES below)
 */
import { readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { findChromiumExecutable } from "../src/lib/screenshot";
import { IOS_SPLASH_DEVICES } from "../src/lib/iosSplashDevices";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");
const SPLASH_DIR = join(PUBLIC_DIR, "splash");
const SVG = readFileSync(join(PUBLIC_DIR, "icon.svg"), "utf8");

const THEMES = {
  light: { bg: "#f5f4fa" },
  dark: { bg: "#100f16" },
} as const;

function splashHtml(theme: keyof typeof THEMES): string {
  const { bg } = THEMES[theme];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}
    html,body{width:100%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center}
    .mark{width:22vw;max-width:220px;aspect-ratio:1}
  </style></head><body><div class="mark">${SVG}</div></body></html>`;
}

function iconHtml(size: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}
    html,body{width:${size}px;height:${size}px}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${SVG}</body></html>`;
}

async function main() {
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    console.error(
      "Aucun Chromium trouvé (CHROMIUM_PATH, /usr/bin/chromium, google-chrome...). Installe-en un (voir lib/browserSession.ts) puis relance ce script."
    );
    process.exit(1);
  }

  mkdirSync(SPLASH_DIR, { recursive: true });

  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();

    async function shoot(html: string, width: number, height: number, outFile: string) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.setContent(html);
      await page.screenshot({ path: outFile as `${string}.png` });
    }

    await shoot(iconHtml(192), 192, 192, join(PUBLIC_DIR, "icon-192.png"));
    await shoot(iconHtml(512), 512, 512, join(PUBLIC_DIR, "icon-512.png"));
    // iOS rounds this corner itself — reusing the 192px render (already rounded in the SVG,
    // same minor double-rounding familyboard's own icon accepts) rather than a separate asset.
    await shoot(iconHtml(180), 180, 180, join(PUBLIC_DIR, "apple-touch-icon.png"));
    console.log("✓ icon-192.png, icon-512.png, apple-touch-icon.png");

    for (const [name, w, h, ratio] of IOS_SPLASH_DEVICES) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const [mw, mh] = orientation === "portrait" ? [w, h] : [h, w];
        for (const theme of ["light", "dark"] as const) {
          const suffix = theme === "dark" ? "-dark" : "";
          const outFile = join(SPLASH_DIR, `${name}-${orientation}${suffix}.png`);
          await shoot(splashHtml(theme), mw * ratio, mh * ratio, outFile);
        }
      }
      console.log(`✓ ${name} (portrait + landscape, clair + sombre)`);
    }
  } finally {
    await browser.close();
  }
  console.log("Terminé.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
