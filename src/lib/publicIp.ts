import https from "https";
import { getSetting, setSetting } from "./db";
import { isValidIpv4 } from "./validators";

const CACHE_KEY = "panel_public_ip";
const CACHE_CHECKED_AT_KEY = "panel_public_ip_checked_at";
const REFRESH_INTERVAL_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 5000;

function fetchExternalIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      "https://api.ipify.org?format=json",
      { timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const ip = JSON.parse(body).ip;
            resolve(typeof ip === "string" && isValidIpv4(ip) ? ip : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/**
 * The IP the panel's own outbound traffic exits with — the fallback for anyone without a router
 * configured under Box & routeurs (whose live WAN IP is used instead, see the status route).
 * Cached in `settings` and refreshed at most every 30min: this is a third-party network call
 * (api.ipify.org), not something to run on every sidebar render.
 */
export async function getPanelPublicIp(): Promise<string | null> {
  const cached = getSetting(CACHE_KEY);
  const checkedAt = getSetting(CACHE_CHECKED_AT_KEY);
  const isFresh = checkedAt && Date.now() - new Date(`${checkedAt}Z`).getTime() < REFRESH_INTERVAL_MS;
  if (isFresh) return cached;

  const ip = await fetchExternalIp();
  if (ip) {
    setSetting(CACHE_KEY, ip);
    setSetting(CACHE_CHECKED_AT_KEY, new Date().toISOString().slice(0, 19).replace("T", " "));
    return ip;
  }
  // A failed lookup shouldn't erase a previously known-good value — just try again next time.
  return cached;
}
