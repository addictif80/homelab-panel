import type {
  RouterProviderClient,
  RouterStatus,
  ConnectedDevice,
  PortForward,
  PortForwardInput,
  WifiNetwork,
} from "./types";

/**
 * Targets the pfSense REST API (built in on 2.5+ under System > REST API, or the community
 * pfSense-pkg-API package on older releases) — both expose the same `/api/v1/...` shape used
 * here. Auth is a static API key/secret pair, sent as headers on every request.
 */
export function createPfSenseClient(config: Record<string, string>, secret: Record<string, string>): RouterProviderClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  async function api(path: string, options: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "x-api-key": secret.apiKey,
        ...(secret.apiSecret ? { "x-api-secret": secret.apiSecret } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`pfSense API ${res.status}: ${text || res.statusText}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async getStatus(): Promise<RouterStatus> {
      const system = (await api("/api/v1/status/system").catch(() => null)) as
        | { data?: { platform?: string; uptime?: string } }
        | null;
      const iface = (await api("/api/v1/status/interface").catch(() => null)) as
        | { data?: { wan?: { ipaddr?: string } } }
        | null;
      const leases = (await api("/api/v1/status/dhcp_leases").catch(() => null)) as { data?: unknown[] } | null;

      return {
        model: system?.data?.platform ?? "pfSense",
        uptimeSeconds: null,
        wanIp: iface?.data?.wan?.ipaddr ?? null,
        connectedDevicesCount: leases?.data?.length ?? null,
      };
    },

    async listDevices(): Promise<ConnectedDevice[]> {
      const result = (await api("/api/v1/status/dhcp_leases")) as {
        data?: { ip?: string; mac?: string; hostname?: string; if?: string }[];
      };
      return (result.data || []).map((l) => ({
        id: l.mac || l.ip || "",
        hostname: l.hostname || null,
        ip: l.ip || "",
        mac: l.mac || "",
        wifi: (l.if || "").toLowerCase().includes("wlan"),
      }));
    },

    async listPortForwards(): Promise<PortForward[]> {
      const result = (await api("/api/v1/firewall/nat/port_forward")) as {
        data?: {
          id?: string | number;
          protocol?: string;
          destination?: { port?: string };
          target?: string;
          local_port?: string;
          descr?: string;
          disabled?: boolean;
        }[];
      };
      return (result.data || []).map((r, i) => ({
        id: String(r.id ?? i),
        protocol: (r.protocol as "tcp" | "udp") || "tcp",
        externalPort: r.destination?.port || "",
        internalIp: r.target || "",
        internalPort: r.local_port || "",
        description: r.descr,
        enabled: !r.disabled,
      }));
    },

    async createPortForward(input: PortForwardInput): Promise<PortForward> {
      const body = {
        interface: "wan",
        protocol: input.protocol === "both" ? "tcp/udp" : input.protocol,
        destination: { port: input.externalPort },
        target: input.internalIp,
        local_port: input.internalPort,
        descr: input.description || "",
      };
      const result = (await api("/api/v1/firewall/nat/port_forward", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { data?: { id?: string | number } };
      return { id: String(result.data?.id ?? ""), ...input };
    },

    async deletePortForward(id: string): Promise<void> {
      await api(`/api/v1/firewall/nat/port_forward?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async listWifiNetworks(): Promise<WifiNetwork[]> {
      // Most pfSense boxes are wired-only (a separate AP handles WiFi) — the REST API has no
      // stable wireless-AP endpoint across versions, so this is intentionally left empty rather
      // than guessing at a shape.
      return [];
    },

    async setWifiEnabled(): Promise<void> {
      throw new Error("La gestion WiFi n'est pas disponible via l'API pfSense.");
    },

    async reboot(): Promise<void> {
      await api("/api/v1/diagnostics/reboot", { method: "POST" });
    },
  };
}
