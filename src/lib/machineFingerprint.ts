import { createHash } from "crypto";
import { readFileSync } from "fs";
import os from "os";

/**
 * A stable identity for this physical/virtual machine that survives the panel's own database
 * being wiped — unlike license.ts's instance_id (stored in panel.db, and therefore reset right
 * along with the trial counter it's meant to protect). /etc/machine-id is the standard identifier
 * on any systemd Linux host; the network-interface fallback covers systems without it. Hashed
 * before it ever leaves this process — the server that verifies trial age only needs to recognize
 * "same machine as before", never the raw machine-id itself.
 */
function readMachineId(): string | null {
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value) return value;
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

function fallbackIdentity(): string {
  const interfaces = Object.values(os.networkInterfaces()).flat();
  const macs = interfaces
    .filter((n): n is NonNullable<typeof n> => !!n && n.mac !== "00:00:00:00:00:00")
    .map((n) => n.mac)
    .sort();
  return `${os.hostname()}|${macs.join(",")}`;
}

let cachedFingerprint: string | null = null;

export function getMachineFingerprint(): string {
  if (!cachedFingerprint) {
    const raw = readMachineId() ?? fallbackIdentity();
    cachedFingerprint = createHash("sha256").update(raw).digest("hex");
  }
  return cachedFingerprint;
}
