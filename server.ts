// Must be registered before anything else starts. Some best-effort background work (screenshot
// capture in particular: launching a system Chromium via puppeteer-core, see lib/screenshot.ts)
// can fail in ways a plain try/catch around the calling code can't reach — e.g. Chromium's child
// process dying right after spawn (missing shared libraries is a common cause on a minimal VM)
// can surface as an 'error' event on an internal EventEmitter with no listener, which Node treats
// as an uncaught exception and — by default — crashes the entire process. For a self-hosted panel
// where that means every feature going down (not just the screenshot), a background capture
// failing is never worth the whole app being unreachable: log it and keep serving.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] Erreur interceptée pour éviter l'arrêt du panel :", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Promesse rejetée sans gestion, interceptée :", reason);
});

import { createServer } from "http";
import next from "next";
import { attachSshWebSocketServer } from "./src/server/ssh-ws";
import { attachLogsWebSocketServer } from "./src/server/logs-ws";
import { startNotificationScheduler } from "./src/lib/notifications/scheduler";
import { startBackupScheduler } from "./src/lib/backup/scheduler";
import { startPulseRecorder } from "./src/lib/pulseRecorder";
import { startHostPublicIpScheduler } from "./src/lib/hostPublicIpScheduler";
import { autoActivateFromBundledKey } from "./src/lib/license";
import { startLicenseRenewalScheduler } from "./src/lib/licenseRenewalScheduler";
import { startMailScheduler } from "./src/lib/mail/mailScheduler";
import { startNpmFailoverScheduler } from "./src/lib/npmFailoverScheduler";
import { startDemoSweeper } from "./src/lib/demo/store";
import { runWithDemoId, DEMO_COOKIE_NAME } from "./src/lib/demo/context";

/** Cheap manual parse — this is the one cookie server.ts itself needs to read, before Next's own
 * request/cookie handling exists yet for this request. */
function readDemoCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${DEMO_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Routes every downstream getDb()/SSH call for this one request to its own isolated /demo
    // sandbox instead of the real database — set here, before Next's own routing/middleware/RSC
    // pipeline runs, so it's already in effect no matter which page or API route ends up handling
    // the request. A request with no (or an unknown/expired) demo cookie falls straight through
    // to the real app, unaffected.
    const demoId = readDemoCookie(req.headers.cookie);
    runWithDemoId(demoId, () => handle(req, res));
  });

  attachSshWebSocketServer(server);
  attachLogsWebSocketServer(server);
  startNotificationScheduler();
  startBackupScheduler();
  startPulseRecorder();
  startHostPublicIpScheduler();
  autoActivateFromBundledKey().catch(() => {});
  startLicenseRenewalScheduler();
  startMailScheduler();
  startNpmFailoverScheduler();
  startDemoSweeper();

  server.listen(port, hostname, () => {
    console.log(`Homelab Panel prêt sur http://${hostname}:${port}`);
  });
});
