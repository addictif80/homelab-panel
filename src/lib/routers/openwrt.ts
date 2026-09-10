import { runSshCommand, shellQuote } from "../ssh";
import type {
  RouterProviderClient,
  RouterStatus,
  ConnectedDevice,
  PortForward,
  PortForwardInput,
  WifiNetwork,
} from "./types";

function exec(hostId: number, cmd: string) {
  return runSshCommand(hostId, cmd, { sudo: true });
}

async function execJson<T>(hostId: number, cmd: string): Promise<T | null> {
  const { stdout, code } = await exec(hostId, cmd);
  if (code !== 0 || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

/** OpenWrt is managed entirely over the SSH connection already on file for this host — `ubus`
 * for structured read-only status (JSON), `uci` for anything that changes persistent config
 * (firewall redirects, wireless), matching how the existing DHCP-server security check already
 * talks to OpenWrt. */
export function createOpenWrtClient(hostId: number): RouterProviderClient {
  return {
    async getStatus(): Promise<RouterStatus> {
      const board = await execJson<{ model?: string; board_name?: string }>(hostId, "ubus call system board");
      const info = await execJson<{ uptime?: number }>(hostId, "ubus call system info");
      const wan = await execJson<{ "ipv4-address"?: { address: string }[] }>(
        hostId,
        "ubus call network.interface.wan status"
      );
      const leases = await exec(hostId, "cat /tmp/dhcp.leases 2>/dev/null");
      const deviceCount = leases.stdout.trim() ? leases.stdout.trim().split("\n").length : 0;

      return {
        model: board?.model || board?.board_name || null,
        uptimeSeconds: info?.uptime ?? null,
        wanIp: wan?.["ipv4-address"]?.[0]?.address ?? null,
        connectedDevicesCount: deviceCount,
      };
    },

    async listDevices(): Promise<ConnectedDevice[]> {
      const leases = await exec(hostId, "cat /tmp/dhcp.leases 2>/dev/null");
      const wifiMacs = new Set<string>();
      // Best-effort: ask every hostapd interface for its associated clients and mark those MACs
      // as wifi — anything else on the lease list is assumed wired.
      const ifaceList = await exec(hostId, "ubus list 2>/dev/null | grep '^hostapd\\.' || true");
      for (const iface of ifaceList.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const clients = await execJson<{ clients?: Record<string, unknown> }>(
          hostId,
          `ubus call ${shellQuote(iface)} get_clients`
        );
        for (const mac of Object.keys(clients?.clients || {})) wifiMacs.add(mac.toLowerCase());
      }

      return leases.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [, mac, ip, hostname] = line.split(/\s+/);
          return {
            id: mac,
            hostname: hostname && hostname !== "*" ? hostname : null,
            ip,
            mac,
            wifi: wifiMacs.has(mac.toLowerCase()),
          };
        });
    },

    async listPortForwards(): Promise<PortForward[]> {
      const { stdout } = await exec(hostId, "uci show firewall 2>/dev/null | grep '@redirect\\['");
      const bySection = new Map<string, Record<string, string>>();
      for (const line of stdout.split("\n")) {
        const m = line.match(/^firewall\.@redirect\[(\d+)\]\.(\w+)='?([^'\n]*)'?$/);
        if (!m) continue;
        const [, idx, key, value] = m;
        if (!bySection.has(idx)) bySection.set(idx, {});
        bySection.get(idx)![key] = value;
      }
      return [...bySection.entries()].map(([idx, f]) => ({
        id: `redirect-${idx}`,
        protocol: (f.proto as "tcp" | "udp") || "tcp",
        externalPort: f.src_dport || "",
        internalIp: f.dest_ip || "",
        internalPort: f.dest_port || "",
        description: f.name,
        enabled: f.enabled !== "0",
      }));
    },

    async createPortForward(input: PortForwardInput): Promise<PortForward> {
      const cmds = [
        `SECTION=$(uci add firewall redirect)`,
        `uci set firewall.$SECTION.target='DNAT'`,
        `uci set firewall.$SECTION.src='wan'`,
        `uci set firewall.$SECTION.proto=${shellQuote(input.protocol === "both" ? "tcp udp" : input.protocol)}`,
        `uci set firewall.$SECTION.src_dport=${shellQuote(input.externalPort)}`,
        `uci set firewall.$SECTION.dest_ip=${shellQuote(input.internalIp)}`,
        `uci set firewall.$SECTION.dest_port=${shellQuote(input.internalPort)}`,
        input.description ? `uci set firewall.$SECTION.name=${shellQuote(input.description)}` : null,
        `uci commit firewall`,
        `/etc/init.d/firewall reload`,
        `echo $SECTION`,
      ].filter(Boolean);
      const { stdout, code, stderr } = await exec(hostId, cmds.join(" && "));
      if (code !== 0) throw new Error(stderr || "Échec de la création de la redirection.");
      return { id: `uci-${stdout.trim()}`, ...input };
    },

    async deletePortForward(id: string): Promise<void> {
      // Positional index into the current @redirect[] list — recomputed at list time, so this
      // assumes no concurrent edit happened between listing and this call (fine for a homelab
      // single-admin tool, not safe for multi-admin race conditions).
      const idx = id.replace("redirect-", "");
      const { code, stderr } = await exec(
        hostId,
        `uci delete firewall.@redirect[${Number(idx)}] && uci commit firewall && /etc/init.d/firewall reload`
      );
      if (code !== 0) throw new Error(stderr || "Échec de la suppression.");
    },

    async listWifiNetworks(): Promise<WifiNetwork[]> {
      const status = await execJson<
        Record<string, { interfaces?: { config?: { ssid?: string; disabled?: boolean }; section?: string }[] }>
      >(hostId, "ubus call network.wireless status");
      if (!status) return [];
      const networks: WifiNetwork[] = [];
      for (const radio of Object.values(status)) {
        for (const iface of radio.interfaces || []) {
          if (!iface.section) continue;
          networks.push({
            id: iface.section,
            band: "",
            ssid: iface.config?.ssid || "(sans nom)",
            enabled: !iface.config?.disabled,
          });
        }
      }
      return networks;
    },

    async setWifiEnabled(id: string, enabled: boolean): Promise<void> {
      const { code, stderr } = await exec(
        hostId,
        `uci set wireless.${shellQuote(id)}.disabled=${enabled ? "0" : "1"} && uci commit wireless && wifi reload`
      );
      if (code !== 0) throw new Error(stderr || "Échec du changement d'état WiFi.");
    },

    async reboot(): Promise<void> {
      await exec(hostId, "reboot");
    },
  };
}
