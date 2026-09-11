/** Strict dotted-quad IPv4 check — every octet must be a plain 0-255 decimal integer, nothing
 * else. Used to validate any IP address field before it's stored, since several places (LAN
 * discovery's ping sweep, firewall rules) later embed these values directly into shell commands
 * run on remote hosts. */
export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Blocks a server-side fetch pointed at loopback or link-local/cloud-metadata addresses when the
 * URL host is a literal IP. Deliberately does NOT block RFC1918 (10/8, 172.16/12, 192.168/16):
 * unlike a typical SaaS SSRF guard, this app's whole point is talking to services on the admin's
 * own LAN (a self-hosted ntfy server, a webhook receiver on another homelab box, ...), so treating
 * "private network" as off-limits would break the feature for most self-hosted setups. What's
 * never legitimate is a notification target resolving back to the panel's own loopback interface
 * (SSRF-to-self, reaching a localhost-only admin port) or the cloud metadata endpoint
 * (169.254.169.254) if the panel happens to run on a VPS/cloud VM. Doesn't resolve DNS names and
 * re-check the resolved address, so it doesn't stop DNS-rebinding against a hostname.
 */
export function isLoopbackOrMetadataHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  if (!isValidIpv4(h)) return false;
  const [a, b] = h.split(".").map(Number);
  return a === 127 || a === 0 || (a === 169 && b === 254);
}
