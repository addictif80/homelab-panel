import { createHmac } from "crypto";
import https from "https";
import http from "http";
import { getCurrentVersion } from "../version";
import type {
  RouterProviderClient,
  RouterStatus,
  ConnectedDevice,
  PortForward,
  PortForwardInput,
  WifiNetwork,
} from "./types";

const APP_ID = "fr.homelabpanel.app";
const APP_NAME = "Homelab Panel";
const DEVICE_NAME = "Homelab Panel";

/**
 * Freebox OS serves its API over HTTPS with a certificate chained to Freebox's own root CA,
 * which isn't in Node's (or most systems') default trust store — Node's global `fetch` rejects
 * it outright before any response comes back, surfacing as an opaque "fetch failed". Using
 * `https.request` directly with `rejectUnauthorized: false` sidesteps that, the same way
 * lib/proxmox.ts and lib/cyberpanel.ts already do for their own self-signed certs.
 */
function requestJson(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        rejectUnauthorized: false,
        headers: {
          ...(options.body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body) }
            : {}),
          ...options.headers,
        },
        timeout: 15_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400 && !raw) {
            reject(new Error(`La Freebox a répondu ${res.statusCode}.`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("Réponse Freebox invalide."));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timeout de connexion à la Freebox.")));
    req.on("error", (err) => reject(new Error(`Connexion à la Freebox impossible : ${err.message}`)));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function apiBase(baseUrl: string): Promise<string> {
  const data = (await requestJson(`${baseUrl.replace(/\/$/, "")}/api_version`)) as {
    api_base_url: string;
    api_domain: string;
    https_port: number;
  };
  // api_version tells us the box's real HTTPS domain/port to use for everything else, even when
  // baseUrl was entered as the plain LAN address.
  return `https://${data.api_domain}:${data.https_port}${data.api_base_url}v8`;
}

export type PairingHandle = { apiUrl: string; trackId: number; appToken: string };

/** Step 1 of pairing: ask the box to start an authorization request — this lights up the request
 * on the Freebox's own screen, and returns an app_token that only becomes valid once someone
 * presses the check button there within the next ~30s (checked via pollPairing). */
export async function startPairing(baseUrl: string): Promise<PairingHandle> {
  const apiUrl = await apiBase(baseUrl);
  const data = (await requestJson(`${apiUrl}/login/authorize/`, {
    method: "POST",
    body: JSON.stringify({ app_id: APP_ID, app_name: APP_NAME, app_version: getCurrentVersion(), device_name: DEVICE_NAME }),
  })) as { success: boolean; msg?: string; result: { track_id: number; app_token: string } };
  if (!data.success) throw new Error(data.msg || "Échec de la demande d'appairage.");
  return { apiUrl, trackId: data.result.track_id, appToken: data.result.app_token };
}

export async function pollPairing(handle: PairingHandle): Promise<"pending" | "granted" | "denied" | "timeout"> {
  const data = (await requestJson(`${handle.apiUrl}/login/authorize/${handle.trackId}`)) as {
    result?: { status?: "pending" | "granted" | "denied" | "timeout" };
  };
  return data.result?.status || "pending";
}

/** Holds in-flight pairing attempts between the "start" and "poll" API calls — short-lived (the
 * physical button on the Freebox has to be pressed within ~30s anyway) so an in-memory map for
 * this single-instance server is enough; no need to persist it. */
const pendingPairings = new Map<string, PairingHandle>();

export function savePairingHandle(sessionId: string, handle: PairingHandle): void {
  pendingPairings.set(sessionId, handle);
  setTimeout(() => pendingPairings.delete(sessionId), 5 * 60_000);
}

export function getPairingHandle(sessionId: string): PairingHandle | undefined {
  return pendingPairings.get(sessionId);
}

export function discardPairingHandle(sessionId: string): void {
  pendingPairings.delete(sessionId);
}

async function openSession(apiUrl: string, appToken: string): Promise<string> {
  const challengeData = (await requestJson(`${apiUrl}/login/`)) as {
    success: boolean;
    result: { challenge: string };
  };
  if (!challengeData.success) throw new Error("Impossible d'ouvrir une session Freebox.");
  const challenge = challengeData.result.challenge;
  const password = createHmac("sha1", appToken).update(challenge).digest("hex");

  const sessionData = (await requestJson(`${apiUrl}/login/session/`, {
    method: "POST",
    body: JSON.stringify({ app_id: APP_ID, password }),
  })) as { success: boolean; msg?: string; result: { session_token: string } };
  if (!sessionData.success) throw new Error(sessionData.msg || "Authentification Freebox refusée.");
  return sessionData.result.session_token;
}

/**
 * Freebox session tokens are short-lived and there's no clean way to check one's validity
 * without trying it, so this just opens a fresh session on every call rather than caching one
 * that might have expired — an extra round trip, but simple and always correct.
 */
export function createFreeboxClient(config: Record<string, string>, secret: Record<string, string>): RouterProviderClient {
  const appToken = secret.appToken;

  async function api(path: string, options: { method?: string; body?: string } = {}): Promise<unknown> {
    const apiUrl = await apiBase(config.baseUrl);
    const sessionToken = await openSession(apiUrl, appToken);
    const data = (await requestJson(`${apiUrl}${path}`, {
      ...options,
      headers: { "X-Fbx-App-Auth": sessionToken },
    })) as { success: boolean; msg?: string; error_code?: string; result: unknown };
    if (!data.success) {
      const detail = data.msg ? `${data.msg}${data.error_code ? ` (${data.error_code})` : ""}` : `Freebox API : erreur sur ${path}`;
      throw new Error(detail);
    }
    return data.result;
  }

  // A handful of Freebox endpoints answer `success: true` with a null/missing `result` instead
  // of an empty list when there's nothing to report (seen in practice on some models/firmwares
  // for certain LAN interfaces) — treat that the same as an empty array rather than crashing.
  async function apiList<T>(path: string, options: { method?: string; body?: string } = {}): Promise<T[]> {
    const result = await api(path, options);
    return Array.isArray(result) ? (result as T[]) : [];
  }

  return {
    async getStatus(): Promise<RouterStatus> {
      const conn = (await api("/connection/")) as { ipv4?: string; state?: string };
      const interfaces = await apiList<{ name: string }>("/lan/browser/interfaces/");
      let deviceCount = 0;
      for (const iface of interfaces) {
        const hosts = await apiList<{ active?: boolean }>(`/lan/browser/${encodeURIComponent(iface.name)}/`);
        deviceCount += hosts.filter((h) => h.active).length;
      }
      return { model: "Freebox", uptimeSeconds: null, wanIp: conn.ipv4 ?? null, connectedDevicesCount: deviceCount };
    },

    async listDevices(): Promise<ConnectedDevice[]> {
      // /lan/browser/interfaces/ lists the actual LAN interfaces (e.g. "pub", "wifi") — each
      // one's own /lan/browser/{name}/ then returns its connected hosts. (A previous version of
      // this code treated "pub" itself as if it were that interface list, then tried to re-query
      // using host names as interface names, which the Freebox rightly rejected.)
      const interfaces = await apiList<{ name: string }>("/lan/browser/interfaces/");
      const devices: ConnectedDevice[] = [];
      for (const iface of interfaces) {
        const hosts = await apiList<{
          id: string;
          primary_name?: string;
          l2ident?: { id: string };
          l3connectivities?: { addr: string; active: boolean }[];
        }>(`/lan/browser/${encodeURIComponent(iface.name)}/`);
        for (const h of hosts) {
          const conn = h.l3connectivities?.find((c) => c.active) || h.l3connectivities?.[0];
          devices.push({
            id: h.id,
            hostname: h.primary_name || null,
            ip: conn?.addr || "",
            mac: h.l2ident?.id || "",
            wifi: iface.name.toLowerCase().includes("wifi"),
          });
        }
      }
      return devices;
    },

    async listPortForwards(): Promise<PortForward[]> {
      const rules = await apiList<{
        id: number;
        enabled: boolean;
        ip_proto: string;
        wan_port_start: number;
        wan_port_end: number;
        lan_ip: string;
        lan_port: number;
        comment?: string;
      }>("/fw/redir/");
      return rules.map((r) => ({
        id: String(r.id),
        protocol: (r.ip_proto as "tcp" | "udp") || "tcp",
        externalPort: r.wan_port_start === r.wan_port_end ? String(r.wan_port_start) : `${r.wan_port_start}-${r.wan_port_end}`,
        internalIp: r.lan_ip,
        internalPort: String(r.lan_port),
        description: r.comment,
        enabled: r.enabled,
      }));
    },

    async createPortForward(input: PortForwardInput): Promise<PortForward> {
      const port = Number(input.externalPort);
      const body = {
        enabled: true,
        ip_proto: input.protocol === "both" ? "tcp" : input.protocol,
        wan_port_start: port,
        wan_port_end: port,
        lan_ip: input.internalIp,
        lan_port: Number(input.internalPort),
        comment: input.description || "",
        // Freebox OS's own web UI always sends src_ip ("any source" = 0.0.0.0) — omitting it
        // makes some firmwares evaluate the rule against a stale/invalid source filter and
        // reject the port as "not available" even though it's genuinely free.
        src_ip: "0.0.0.0",
      };
      const result = (await api("/fw/redir/", { method: "POST", body: JSON.stringify(body) })) as { id: number };
      return { id: String(result.id), ...input };
    },

    async deletePortForward(id: string): Promise<void> {
      await api(`/fw/redir/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async listWifiNetworks(): Promise<WifiNetwork[]> {
      const wifi = (await api("/wifi/config/")) as { enabled: boolean };
      // The per-band access-point endpoints vary across Freebox models (Pop/Delta/Revolution) —
      // this exposes the one thing that's consistent across all of them: the global WiFi toggle.
      return [{ id: "global", band: "", ssid: "WiFi Freebox", enabled: wifi.enabled }];
    },

    async setWifiEnabled(_id: string, enabled: boolean): Promise<void> {
      await api("/wifi/config/", { method: "PUT", body: JSON.stringify({ enabled }) });
    },

    async reboot(): Promise<void> {
      await api("/system/reboot/", { method: "POST" });
    },
  };
}
