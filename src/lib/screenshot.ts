import { existsSync, realpathSync } from "fs";

/**
 * Server-side screenshot capture for service links (/services, /board, and the seller's public
 * directory) — drives a Chromium already installed on the host via puppeteer-core (no bundled
 * browser download, unlike plain puppeteer) rather than sending the URL to a third-party
 * screenshot API, consistent with this app's "nothing about your infrastructure leaves your own
 * network" stance elsewhere (favicon fetching works the same way). Best-effort: no Chromium found,
 * a slow/unreachable site, or any capture error just means no screenshot — never blocks creating
 * or editing a link, and never — see the extra care below — takes the rest of the panel down with
 * it if the Chromium binary itself misbehaves (missing shared libraries on a minimal VM is a
 * common way for that to happen).
 */

const CANDIDATE_PATHS = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  // Playwright's own bundled Chromium, when present (e.g. a dev/CI environment that already has
  // it) — harmless to check for, and saves an install step there.
  "/opt/pw-browsers/chromium",
].filter((p): p is string => !!p);

let cachedExecutablePath: string | null | undefined;

/**
 * On Ubuntu, `apt install chromium` (and `chromium-browser`) hasn't installed a real package in
 * years — it's a transitional stub whose binary is a wrapper script that launches the *snap*
 * build instead, and `/usr/bin/chromium` itself is usually a symlink straight into `/snap/bin/`.
 * That snap runs under its own AppArmor confinement and mount namespace, which routinely refuses
 * to launch headless the way puppeteer needs it to — most reliably inside a Docker container or an
 * LXC guest, where snapd frequently isn't even running at all (this bit the RDP/screenshot features
 * before: a path that *exists* on disk but can't actually be spawned this way). Trusting
 * `existsSync` alone on a snap-shadowed path reports success and then fails later with an opaque
 * Chromium launch error — so a candidate that resolves into `/snap/` is treated as not found here,
 * pushing callers toward the install instructions for a real .deb instead (see
 * checkBrowserDependencies in lib/browserSession.ts).
 */
function isSnapShadowed(path: string): boolean {
  try {
    return realpathSync(path).includes("/snap/");
  } catch {
    return false;
  }
}

/** Exported for reuse by anything else that drives a local Chromium via puppeteer-core (the
 * embedded interactive browser in lib/browserSession.ts, notably) — one place to look for a
 * usable binary instead of duplicating this candidate-path list. */
export function findChromiumExecutable(): string | null {
  if (cachedExecutablePath !== undefined) return cachedExecutablePath;
  cachedExecutablePath = CANDIDATE_PATHS.find((p) => existsSync(p) && !isSnapShadowed(p)) ?? null;
  return cachedExecutablePath;
}

/** Exposed so the UI can explain "no screenshot" rather than showing a bare blank space. */
export function isScreenshotCaptureAvailable(): boolean {
  return findChromiumExecutable() !== null;
}

const NAVIGATION_TIMEOUT_MS = 15_000;
// A hard ceiling on the *whole* capture, independent of puppeteer's own navigation timeout — a
// Chromium binary that's present but broken (missing shared libraries, incompatible glibc...) can
// hang during launch rather than cleanly failing, which page.goto()'s own timeout never covers.
const OVERALL_TIMEOUT_MS = 25_000;
const VIEWPORT = { width: 1280, height: 800 };

async function captureScreenshotInner(url: string, executablePath: string): Promise<string | null> {
  const puppeteer = await import("puppeteer-core");
  let browser: import("puppeteer-core").Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-zygote",
      ],
    });

    // Chromium's own process dying unexpectedly (missing shared libs, OOM, a segfault) can surface
    // as an 'error' event on the underlying child process — an EventEmitter, and Node treats an
    // unhandled 'error' event as fatal for the whole process by default. This listener alone is
    // enough to stop that: an attached (even no-op) 'error' handler downgrades it to an ordinary,
    // locally-handled event instead of a process-crashing uncaught exception. (server.ts also has
    // a process-wide safety net for this same class of failure, in case it surfaces some other
    // way — defense in depth, not a reason to skip this.)
    browser.process()?.on("error", () => {});

    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
    const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
    return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
  } catch (err) {
    // Best-effort by design (never blocks creating/editing a link), but silent failure makes this
    // impossible to diagnose remotely — log it so pm2/journalctl shows the real cause (Chromium
    // launch failure, unreachable URL, self-signed cert, navigation timeout...).
    console.error(`[screenshot] Échec de la capture pour ${url} :`, err);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

// Screenshot captures are serialized rather than run concurrently — each one launches a full
// Chromium process, and doing several at once (e.g. bulk-adding services) multiplies whatever
// resource pressure a single capture puts on the host for no real benefit, since this is already
// a background, best-effort step rather than something a user waits on interactively elsewhere.
let queue: Promise<unknown> = Promise.resolve();

export function captureScreenshot(url: string): Promise<string | null> {
  const executablePath = findChromiumExecutable();
  if (!executablePath) return Promise.resolve(null);

  const run = queue.then(() =>
    Promise.race([
      captureScreenshotInner(url, executablePath),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), OVERALL_TIMEOUT_MS)),
    ]).catch(() => null)
  );
  // Keep the queue moving even if this capture fails — a swallowed-error copy so one bad capture
  // doesn't wedge every capture after it.
  queue = run.catch(() => {});
  return run;
}
