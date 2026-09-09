import { runSshCommand, shellQuote } from "./ssh";

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isValidIpv4(ip: string): boolean {
  if (!IPV4_RE.test(ip)) return false;
  return ip.split(".").every((part) => Number(part) <= 255);
}

/** Inserts a DROP rule for this IP at the top of INPUT via iptables, on the given host. */
export async function blockIp(hostId: number, ip: string): Promise<void> {
  if (!isValidIpv4(ip)) throw new Error("Adresse IP invalide.");

  const command = `iptables -C INPUT -s ${shellQuote(ip)} -j DROP 2>/dev/null || iptables -I INPUT -s ${shellQuote(ip)} -j DROP`;
  const { code, stderr } = await runSshCommand(hostId, command, { sudo: true });
  if (code !== 0) throw new Error(stderr || "Échec du blocage iptables.");
}
