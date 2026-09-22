import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { getDb } from "../db";
import { vaultDecrypt } from "../crypto";

const execFileAsync = promisify(execFile);

/**
 * RDP-over-HTTP-polling: the same WebSocket-free transport as the SSH terminal
 * (see terminalPollSessions.ts), for the same reason — a network that blocks the WS upgrade
 * outright still lets plain HTTPS requests through. There's no browser-native way to speak RDP
 * directly, so instead of a protocol relay this shells out to `xfreerdp` (Apache-2.0, unlike the
 * only pure-Node RDP client, which is AGPL-3.0 and unmaintained — a real risk to ship inside a
 * commercial product) rendering into a headless `Xvfb` display, then polls that display as PNG
 * screenshots (ImageMagick's `import`) and injects input back into it (`xdotool`), mirroring this
 * codebase's existing pattern of shelling out to real binaries (ssh/rsync/docker) rather than
 * reimplementing their protocols.
 */

type RdpSession = {
  id: string;
  username: string;
  hostId: number;
  display: number;
  xvfb: ChildProcess;
  xfreerdp: ChildProcess;
  lastFrame: Buffer | null;
  frameSeq: number;
  capturing: boolean;
  captureTimer: ReturnType<typeof setInterval> | null;
  closed: boolean;
  lastActivity: number;
  error: string | null;
};

const sessions = new Map<string, RdpSession>();
const DISPLAY_BASE = 100;
const MAX_DISPLAYS = 200;
const usedDisplays = new Set<number>();
const FRAME_INTERVAL_MS = 700;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;
const CAPTURE_TIMEOUT_MS = 5_000;

const REQUIRED_BINARIES = ["Xvfb", "xfreerdp", "import", "xdotool"] as const;

/** Checked once per session start rather than once at process boot: the panel itself may be
 * upgraded onto a machine that never had these installed, and a clear "install this" error the
 * first time someone opens the RDP page beats a silent ENOENT from a spawned child process. */
export async function checkRdpDependencies(): Promise<string | null> {
  const missing: string[] = [];
  for (const bin of REQUIRED_BINARIES) {
    try {
      await execFileAsync("which", [bin]);
    } catch {
      missing.push(bin);
    }
  }
  if (missing.length === 0) return null;
  return (
    `Le client RDP a besoin de paquets supplémentaires sur la machine qui héberge le panel ` +
    `(binaires manquants : ${missing.join(", ")}). Installe-les avec : ` +
    `sudo apt-get install -y --no-install-recommends xvfb freerdp2-x11 imagemagick xdotool`
  );
}

function allocateDisplay(): number {
  for (let n = DISPLAY_BASE; n < DISPLAY_BASE + MAX_DISPLAYS; n++) {
    if (!usedDisplays.has(n)) {
      usedDisplays.add(n);
      return n;
    }
  }
  throw new Error("Trop de sessions RDP actives en même temps.");
}

function releaseDisplay(n: number) {
  usedDisplays.delete(n);
}

function touch(session: RdpSession) {
  session.lastActivity = Date.now();
}

type RdpCredentialRow = { port: number; username: string; password_encrypted: string };

function getRdpCredential(hostId: number): { port: number; username: string; password: string } | null {
  const row = getDb()
    .prepare(`SELECT port, username, password_encrypted FROM rdp_credentials WHERE host_id = ?`)
    .get(hostId) as RdpCredentialRow | undefined;
  if (!row) return null;
  return { port: row.port, username: row.username, password: vaultDecrypt(row.password_encrypted) };
}

type HostRow = { lan_ip: string | null; tailscale_ip: string | null; public_ip: string | null; name: string };

function getHostAddress(hostId: number): { address: string; name: string } {
  const host = getDb().prepare(`SELECT lan_ip, tailscale_ip, public_ip, name FROM hosts WHERE id = ?`).get(hostId) as
    | HostRow
    | undefined;
  if (!host) throw new Error("Machine introuvable.");
  const address = host.tailscale_ip || host.lan_ip || host.public_ip;
  if (!address) throw new Error("Aucune adresse IP renseignée pour cette machine.");
  return { address, name: host.name };
}

async function captureFrame(display: number): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync("import", ["-display", `:${display}`, "-window", "root", "png:-"], {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      timeout: CAPTURE_TIMEOUT_MS,
    });
    return stdout as unknown as Buffer;
  } catch {
    return null;
  }
}

function startCapture(session: RdpSession) {
  session.capturing = true;
  session.captureTimer = setInterval(async () => {
    if (session.closed) return;
    const frame = await captureFrame(session.display);
    if (frame) {
      session.lastFrame = frame;
      session.frameSeq += 1;
    }
  }, FRAME_INTERVAL_MS);
}

/** Starts a new RDP session for `hostId`, owned by `username`. Spawns a private Xvfb display and
 * an xfreerdp process pointed at it, then begins periodic screenshot capture. Returns the new
 * session id immediately — the caller polls getFrame() for the first frame once xfreerdp connects. */
export function createRdpSession(hostId: number, username: string): string {
  ensureSweep();
  const cred = getRdpCredential(hostId);
  if (!cred) throw new Error("Aucun identifiant RDP enregistré pour cette machine.");
  const { address, name } = getHostAddress(hostId);

  const display = allocateDisplay();
  const id = randomUUID();

  const xvfb = spawn("Xvfb", [`:${display}`, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
    stdio: "ignore",
  });

  const session: RdpSession = {
    id,
    username,
    hostId,
    display,
    xvfb,
    xfreerdp: null as unknown as ChildProcess,
    lastFrame: null,
    frameSeq: 0,
    capturing: false,
    captureTimer: null,
    closed: false,
    lastActivity: Date.now(),
    error: null,
  };

  xvfb.on("exit", () => {
    if (!session.closed) {
      session.error = "Le serveur d'affichage virtuel s'est arrêté de façon inattendue.";
      session.closed = true;
    }
  });

  // Give Xvfb a moment to bind its socket before pointing xfreerdp at it.
  setTimeout(() => {
    if (session.closed) return;
    const xfreerdp = spawn(
      "xfreerdp",
      [
        `/v:${address}:${cred.port}`,
        `/u:${cred.username}`,
        `/p:${cred.password}`,
        "/w:1280",
        "/h:800",
        "/bpp:16",
        "/cert:ignore",
        "/sec:nla",
        "-wallpaper",
        "-themes",
        "+clipboard",
        "/log-level:ERROR",
      ],
      { env: { ...process.env, DISPLAY: `:${display}` }, stdio: ["ignore", "ignore", "pipe"] }
    );
    session.xfreerdp = xfreerdp;

    let stderrTail = "";
    xfreerdp.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4000);
    });
    xfreerdp.on("exit", (code) => {
      if (!session.closed && code !== 0) {
        session.error = stderrTail.trim() || `xfreerdp s'est arrêté (code ${code}).`;
        session.closed = true;
      }
    });

    startCapture(session);
  }, 800);

  sessions.set(id, session);
  void name; // kept for future audit logging, not currently logged
  return id;
}

function getOwnedSession(id: string, username: string): RdpSession | null {
  const session = sessions.get(id);
  if (!session || session.username !== username) return null;
  return session;
}

export function getFrame(
  id: string,
  username: string
): { frame: string | null; seq: number; closed: boolean; error: string | null } | null {
  const session = getOwnedSession(id, username);
  if (!session) return null;
  touch(session);
  return {
    frame: session.lastFrame ? session.lastFrame.toString("base64") : null,
    seq: session.frameSeq,
    closed: session.closed,
    error: session.error,
  };
}

function runXdotool(display: number, args: string[]): void {
  execFile("xdotool", args, { env: { ...process.env, DISPLAY: `:${display}` }, timeout: 3_000 }, () => {
    // Best-effort — a single dropped input event isn't worth surfacing to the user.
  });
}

export type RdpInput =
  | { type: "mousemove"; x: number; y: number }
  | { type: "mousedown"; button: number }
  | { type: "mouseup"; button: number }
  | { type: "scroll"; deltaY: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "text"; text: string };

export function sendInput(id: string, username: string, input: RdpInput): boolean {
  const session = getOwnedSession(id, username);
  if (!session || session.closed) return false;
  touch(session);
  const display = session.display;

  switch (input.type) {
    case "mousemove":
      runXdotool(display, ["mousemove", "--sync", String(Math.round(input.x)), String(Math.round(input.y))]);
      break;
    case "mousedown":
      runXdotool(display, ["mousedown", String(input.button)]);
      break;
    case "mouseup":
      runXdotool(display, ["mouseup", String(input.button)]);
      break;
    case "scroll":
      runXdotool(display, ["click", input.deltaY > 0 ? "5" : "4"]);
      break;
    case "keydown":
      runXdotool(display, ["keydown", input.key]);
      break;
    case "keyup":
      runXdotool(display, ["keyup", input.key]);
      break;
    case "text":
      runXdotool(display, ["type", "--clearmodifiers", "--", input.text]);
      break;
  }
  return true;
}

export function closeRdpSession(id: string, username: string): void {
  const session = getOwnedSession(id, username);
  if (!session) return;
  session.closed = true;
  if (session.captureTimer) clearInterval(session.captureTimer);
  try {
    session.xfreerdp?.kill();
  } catch {
    // already dead
  }
  try {
    session.xvfb.kill();
  } catch {
    // already dead
  }
  releaseDisplay(session.display);
  sessions.delete(id);
}

let sweepStarted = false;
function ensureSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        closeRdpSession(id, session.username);
      }
    }
  }, SWEEP_INTERVAL_MS);
}
