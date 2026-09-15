import { existsSync } from "fs";

/**
 * Server-side screenshot capture for service links (/services, /board, and the seller's public
 * directory) — drives a Chromium already installed on the host via puppeteer-core (no bundled
 * browser download, unlike plain puppeteer) rather than sending the URL to a third-party
 * screenshot API, consistent with this app's "nothing about your infrastructure leaves your own
 * network" stance elsewhere (favicon fetching works the same way). Best-effort: no Chromium found,
 * a slow/unreachable site, or any capture error just means no screenshot — never blocks creating
 * or editing a link.
 */

const CANDIDATE_PATHS = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
  // Playwright's own bundled Chromium, when present (e.g. a dev/CI environment that already has
  // it) — harmless to check for, and saves an install step there.
  "/opt/pw-browsers/chromium",
].filter((p): p is string => !!p);

let cachedExecutablePath: string | null | undefined;

function findChromiumExecutable(): string | null {
  if (cachedExecutablePath !== undefined) return cachedExecutablePath;
  cachedExecutablePath = CANDIDATE_PATHS.find((p) => existsSync(p)) ?? null;
  return cachedExecutablePath;
}

/** Exposed so the UI can explain "no screenshot" rather than showing a bare blank space. */
export function isScreenshotCaptureAvailable(): boolean {
  return findChromiumExecutable() !== null;
}

const CAPTURE_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1280, height: 800 };

export async function captureScreenshot(url: string): Promise<string | null> {
  const executablePath = findChromiumExecutable();
  if (!executablePath) return null;

  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: CAPTURE_TIMEOUT_MS });
    const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
    return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
