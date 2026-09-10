import { createHmac } from "crypto";
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

async function apiBase(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api_version`);
  if (!res.ok) throw new Error("Impossible de contacter la Freebox — vérifie l'URL.");
  const data = (await res.json()) as { api_base_url: string; api_domain: string; https_port: number };
  // Freebox OS serves its API over HTTPS on its own domain/port even when baseUrl was entered
  // as the plain LAN address — api_version tells us the real one to use from here on.
  return `https://${data.api_domain}:${data.https_port}${data.api_base_url}v8`;
}

export type PairingHandle = { apiUrl: string; trackId: number; appToken: string };

/** Step 1 of pairing: ask the box to start an authorization request — this lights up the request
 * on the Freebox's own screen, and returns an app_token that only becomes valid once someone
 * presses the check button there within the next ~30s (checked via pollPairing). */
export async function startPairing(baseUrl: string): Promise<PairingHandle> {
  const apiUrl = await apiBase(baseUrl);
  const res = await fetch(`${apiUrl}/login/authorize/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_name: APP_NAME, app_version: getCurrentVersion(), device_name: DEVICE_NAME }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.msg || "Échec de la demande d'appairage.");
  return { apiUrl, trackId: data.result.track_id, appToken: data.result.app_token };
}

export async function pollPairing(handle: PairingHandle): Promise<"pending" | "granted" | "denied" | "timeout"> {
  const res = await fetch(`${handle.apiUrl}/login/authorize/${handle.trackId}`);
  const data = await res.json();
  return (data.result?.status as "pending" | "granted" | "denied" | "timeout") || "pending";
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
  const challengeRes = await fetch(`${apiUrl}/login/`);
  const challengeData = await challengeRes.json();
  if (!challengeData.success) throw new Error("Impossible d'ouvrir une session Freebox.");
  const challenge = challengeData.result.challenge as string;
  const password = createHmac("sha1", appToken).update(challenge).digest("hex");

  const sessionRes = await fetch(`${apiUrl}/login/session/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, password }),
  });
  const sessionData = await sessionRes.json();
  if (!sessionData.success) throw new Error(sessionData.msg || "Authentification Freebox refusée.");
  return sessionData.result.session_token as string;
}

/**
 * Freebox session tokens are short-lived and there's no clean way to check one's validity
 * without trying it, so this just opens a fresh session on every call rather than caching one
 * that might have expired — an extra round trip, but simple and always correct.
 */
export function createFreeboxClient(config: Record<string, string>, secret: Record<string, string>): RouterProviderClient {
  const appToken = secret.appToken;

  async function api(path: string, options: RequestInit = {}): Promise<unknown> {
    const apiUrl = await apiBase(config.baseUrl);
    const sessionToken = await openSession(apiUrl, appToken);
    const res = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "X-Fbx-App-Auth": sessionToken,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.msg || `Freebox API : erreur sur ${path}`);
    return data.result;
  }

  return {
    async getStatus(): Promise<RouterStatus> {
      const conn = (await api("/connection/")) as { ipv4?: string; state?: string };
      const lanInterfaces = (await api("/lan/browser/pub/")) as { name: string }[];
      let deviceCount = 0;
      for (const iface of lanInterfaces) {
        const hosts = (await api(`/lan/browser/${encodeURIComponent(iface.name)}/`)) as { active?: boolean }[];
        deviceCount += hosts.filter((h) => h.active).length;
      }
      return { model: "Freebox", uptimeSeconds: null, wanIp: conn.ipv4 ?? null, connectedDevicesCount: deviceCount };
    },

    async listDevices(): Promise<ConnectedDevice[]> {
      const lanInterfaces = (await api("/lan/browser/pub/")) as { name: string }[];
      const devices: ConnectedDevice[] = [];
      for (const iface of lanInterfaces) {
        const hosts = (await api(`/lan/browser/${encodeURIComponent(iface.name)}/`)) as {
          id: string;
          primary_name?: string;
          l2ident?: { id: string };
          l3connectivities?: { addr: string; active: boolean }[];
        }[];
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
      const rules = (await api("/fw/redir/")) as {
        id: number;
        enabled: boolean;
        ip_proto: string;
        wan_port_start: number;
        wan_port_end: number;
        lan_ip: string;
        lan_port: number;
        comment?: string;
      }[];
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
