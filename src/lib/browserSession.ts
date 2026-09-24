import { randomUUID } from "crypto";
import { findChromiumExecutable } from "./screenshot";
import type { Browser, CDPSession, KeyInput, Page } from "puppeteer-core";

/**
 * Embedded browser over HTTP polling — the same WebSocket-free transport as the SSH terminal and
 * RDP viewer (see terminalPollSessions.ts / lib/rdp/session.ts), for the same reason: it works on
 * a network that blocks the WS upgrade outright, which every off-the-shelf "browser in Docker"
 * image (Kasm, linuxserver/chromium...) can't manage since they all speak noVNC/Guacamole over a
 * WebSocket to the browser tab actually watching them. Instead of relaying a remote-desktop
 * protocol, this drives a real headless Chromium (via puppeteer-core, already a dependency for
 * service-link screenshots — see lib/screenshot.ts) directly on the machine running the panel, and
 * streams it as JPEG frames via the Chrome DevTools Protocol's `Page.startScreencast` — Chromium's
 * own CDP WebSocket never leaves this process, since puppeteer talks to it over a local pipe/port
 * on the same host. Mouse/keyboard go back in through Puppeteer's own page.mouse/page.keyboard,
 * which is simpler and more correct than hand-rolling CDP Input.dispatch* calls. This is what lets
 * the panel reach a Tailscale-only service's web UI from a network that would otherwise block any
 * of the noVNC-based alternatives.
 */

type BrowserSession = {
  id: string;
  username: string;
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  lastFrame: string | null;
  frameSeq: number;
  url: string;
  title: string;
  closed: boolean;
  error: string | null;
  lastActivity: number;
  waiters: (() => void)[];
};

const sessions = new Map<string, BrowserSession>();
const VIEWPORT = { width: 1280, height: 800 };
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const MAX_SESSIONS_PER_USER = 4;

export function checkBrowserDependencies(): string | null {
  if (findChromiumExecutable()) return null;
  return (
    "Le navigateur intégré a besoin d'un vrai Chromium sur la machine qui héberge le panel. " +
    "Sur Ubuntu, évite `sudo apt install chromium` — ce paquet ne fait qu'installer la version " +
    "snap, dont le confinement empêche souvent un lancement headless (surtout dans un conteneur " +
    "Docker ou LXC, où snapd ne tourne parfois même pas). Installe plutôt Google Chrome en .deb : " +
    "wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && " +
    "sudo apt install -y ./google-chrome-stable_current_amd64.deb " +
    "— ou, sur Debian (pas Ubuntu), `sudo apt install -y chromium` installe un vrai paquet natif."
  );
}

function touch(session: BrowserSession) {
  session.lastActivity = Date.now();
}

function notifyWaiters(session: BrowserSession) {
  const waiters = session.waiters.splice(0);
  for (const resolve of waiters) resolve();
}

function isAllowedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

export async function createBrowserSession(rawUrl: string, username: string): Promise<string> {
  const url = isAllowedUrl(rawUrl);
  if (!url) throw new Error("Adresse invalide — seules les URL http(s) sont autorisées.");

  const executablePath = findChromiumExecutable();
  if (!executablePath) throw new Error(checkBrowserDependencies() || "Chromium introuvable.");

  const existingForUser = [...sessions.values()].filter((s) => s.username === username && !s.closed);
  if (existingForUser.length >= MAX_SESSIONS_PER_USER) {
    throw new Error(`Trop d'onglets ouverts (max ${MAX_SESSIONS_PER_USER}) — ferme-en un avant d'en ouvrir un nouveau.`);
  }

  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-zygote",
      // Off-the-shelf noVNC browser images ship a click-through cert warning; this panel already
      // gates access behind the panel's own auth, so a self-signed cert on an internal Tailscale
      // service (very common — Proxmox, TrueNAS, a router's own UI...) shouldn't need a manual
      // bypass every single time a tab opens.
      "--ignore-certificate-errors",
    ],
  });
  browser.process()?.on("error", () => {});

  const id = randomUUID();
  let page: Page;
  let cdp: CDPSession;
  try {
    page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    cdp = await page.createCDPSession();
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }

  const session: BrowserSession = {
    id,
    username,
    browser,
    page,
    cdp,
    lastFrame: null,
    frameSeq: 0,
    url,
    title: "",
    closed: false,
    error: null,
    lastActivity: Date.now(),
    waiters: [],
  };
  sessions.set(id, session);

  cdp.on("Page.screencastFrame", (frame) => {
    session.lastFrame = frame.data;
    session.frameSeq += 1;
    notifyWaiters(session);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      session.url = frame.url();
      page
        .title()
        .then((t) => {
          session.title = t;
        })
        .catch(() => {});
    }
  });

  browser.on("disconnected", () => {
    if (!session.closed) {
      session.closed = true;
      session.error = "Le navigateur intégré s'est arrêté de façon inattendue.";
      notifyWaiters(session);
    }
  });

  try {
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    session.title = await page.title().catch(() => "");
  } catch (err) {
    session.error = err instanceof Error ? err.message : "Échec du chargement de la page.";
  }

  ensureSweep();
  return id;
}

function getOwnedSession(id: string, username: string): BrowserSession | null {
  const session = sessions.get(id);
  if (!session || session.username !== username) return null;
  return session;
}

export type BrowserFrameResult = {
  frame: string | null;
  seq: number;
  url: string;
  title: string;
  closed: boolean;
  error: string | null;
};

function toResult(session: BrowserSession): BrowserFrameResult {
  return {
    frame: session.lastFrame,
    seq: session.frameSeq,
    url: session.url,
    title: session.title,
    closed: session.closed,
    error: session.error,
  };
}

/** Long-polls up to `timeoutMs` for a frame newer than `sinceSeq` — the same event-driven pattern
 * as terminalPollSessions.ts's waitForOutput, giving near-real-time updates without a WebSocket. */
export async function waitForFrame(
  id: string,
  username: string,
  sinceSeq: number,
  timeoutMs: number
): Promise<BrowserFrameResult | null> {
  const session = getOwnedSession(id, username);
  if (!session) return null;
  touch(session);

  if (session.frameSeq > sinceSeq || session.closed) {
    return toResult(session);
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    session.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  const stillThere = getOwnedSession(id, username);
  if (!stillThere) return null;
  return toResult(stillThere);
}

export type BrowserInput =
  | { type: "mousemove"; x: number; y: number }
  | { type: "mousedown"; button: "left" | "right" | "middle" }
  | { type: "mouseup"; button: "left" | "right" | "middle" }
  | { type: "wheel"; deltaX: number; deltaY: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string };

export async function sendInput(id: string, username: string, input: BrowserInput): Promise<boolean> {
  const session = getOwnedSession(id, username);
  if (!session || session.closed) return false;
  touch(session);

  try {
    switch (input.type) {
      case "mousemove":
        await session.page.mouse.move(input.x, input.y);
        break;
      case "mousedown":
        await session.page.mouse.down({ button: input.button });
        break;
      case "mouseup":
        await session.page.mouse.up({ button: input.button });
        break;
      case "wheel":
        await session.page.mouse.wheel({ deltaX: input.deltaX, deltaY: input.deltaY });
        break;
      case "keydown":
        await session.page.keyboard.down(input.key as KeyInput);
        break;
      case "keyup":
        await session.page.keyboard.up(input.key as KeyInput);
        break;
    }
  } catch {
    // A key/mouse event racing a navigation or a closing page isn't worth surfacing to the user —
    // the next frame poll will show whatever actually happened.
  }
  return true;
}

export type BrowserNavigate =
  | { action: "goto"; url: string }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" };

export async function navigate(id: string, username: string, nav: BrowserNavigate): Promise<boolean> {
  const session = getOwnedSession(id, username);
  if (!session || session.closed) return false;
  touch(session);

  try {
    if (nav.action === "goto") {
      const url = isAllowedUrl(nav.url);
      if (!url) throw new Error("Adresse invalide.");
      await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } else if (nav.action === "back") {
      await session.page.goBack({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } else if (nav.action === "forward") {
      await session.page.goForward({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } else {
      await session.page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    }
    session.error = null;
  } catch (err) {
    session.error = err instanceof Error ? err.message : "Échec de la navigation.";
  }
  session.url = session.page.url();
  session.title = await session.page.title().catch(() => session.title);
  return true;
}

export function closeBrowserSession(id: string, username: string): void {
  const session = getOwnedSession(id, username);
  if (!session) return;
  session.closed = true;
  sessions.delete(id);
  session.browser.close().catch(() => {});
}

let sweepStarted = false;
function ensureSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        session.closed = true;
        session.browser.close().catch(() => {});
        sessions.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
}
