import { runSshCommand, shellQuote } from "./ssh";

/**
 * SSH-based hardware telemetry — works on the existing fleet (physical boxes without a BMC/IPMI
 * controller included) using whatever monitoring tools are already on the box, rather than
 * requiring IPMI/SNMP credentials to be configured separately. A tool that isn't installed is
 * reported in `toolsMissing` instead of failing the whole call.
 */

export type TemperatureReading = { label: string; celsius: number };
export type DiskHealth = { device: string; healthy: boolean | null; temperatureC: number | null; reallocatedSectors: number | null };
export type UpsStatus = { status: string; chargePercent: number | null };

export type HardwareHealth = {
  temperatures: TemperatureReading[];
  disks: DiskHealth[];
  ups: UpsStatus | null;
  toolsMissing: string[];
};

function parseSensors(output: string): TemperatureReading[] {
  const lines = output.split("\n");
  const readings: TemperatureReading[] = [];
  let currentLabel = "";
  for (const line of lines) {
    const subLabelMatch = line.match(/^ {2}(\S.*):\s*$/);
    if (subLabelMatch) {
      currentLabel = subLabelMatch[1];
      continue;
    }
    const inputMatch = line.match(/^\s+temp\d+_input:\s*([\d.]+)/);
    if (inputMatch) {
      readings.push({ label: currentLabel || "temp", celsius: parseFloat(inputMatch[1]) });
    }
  }
  return readings;
}

function parseSmart(output: string): { healthy: boolean | null; temperatureC: number | null; reallocatedSectors: number | null } {
  const healthy = /PASSED/i.test(output) ? true : /FAILED/i.test(output) ? false : null;
  const tempMatch = output.match(/(?:Temperature_Celsius|Airflow_Temperature_Cel).*?\n?.*?\s(\d+)\s*(?:\(|$)/m);
  const reallocMatch = output.match(/Reallocated_Sector_Ct.*?\s(\d+)\s*$/m);
  return {
    healthy,
    temperatureC: tempMatch ? Number(tempMatch[1]) : null,
    reallocatedSectors: reallocMatch ? Number(reallocMatch[1]) : null,
  };
}

async function getUpsStatus(hostId: number): Promise<UpsStatus | null> {
  const list = await runSshCommand(hostId, "upsc -l 2>/dev/null").catch(() => null);
  const upsName = list?.code === 0 ? list.stdout.trim().split("\n")[0] : "";
  if (upsName) {
    const detail = await runSshCommand(hostId, `upsc ${shellQuote(upsName)} 2>/dev/null`).catch(() => null);
    if (detail?.stdout) {
      const status = detail.stdout.match(/^ups\.status:\s*(.+)$/m)?.[1]?.trim();
      const charge = detail.stdout.match(/^battery\.charge:\s*([\d.]+)/m)?.[1];
      if (status) return { status, chargePercent: charge ? Math.round(Number(charge)) : null };
    }
  }

  const apc = await runSshCommand(hostId, "apcaccess status 2>/dev/null").catch(() => null);
  if (apc?.code === 0 && apc.stdout.trim()) {
    const status = apc.stdout.match(/^STATUS\s*:\s*(.+)$/m)?.[1]?.trim();
    const charge = apc.stdout.match(/^BCHARGE\s*:\s*([\d.]+)/m)?.[1];
    if (status) return { status, chargePercent: charge ? Math.round(Number(charge)) : null };
  }

  return null;
}

export async function getHardwareHealth(hostId: number): Promise<HardwareHealth> {
  const toolsMissing: string[] = [];

  const sensorsRes = await runSshCommand(hostId, "sensors -u 2>/dev/null").catch(() => null);
  const temperatures = sensorsRes?.code === 0 && sensorsRes.stdout.trim() ? parseSensors(sensorsRes.stdout) : [];
  if (temperatures.length === 0) toolsMissing.push("lm-sensors");

  const disks: DiskHealth[] = [];
  const lsblkRes = await runSshCommand(hostId, "lsblk -d -n -o NAME,TYPE 2>/dev/null").catch(() => null);
  const diskNames = (lsblkRes?.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(" disk") || l.endsWith("\tdisk"))
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean);

  let smartAvailable = false;
  for (const device of diskNames) {
    const smart = await runSshCommand(hostId, `smartctl -H -A /dev/${device} 2>/dev/null`, { sudo: true }).catch(() => null);
    if (!smart || smart.code === 127 || /command not found|not recognized/i.test(smart.stderr || "")) continue;
    smartAvailable = true;
    disks.push({ device, ...parseSmart(smart.stdout) });
  }
  if (!smartAvailable) toolsMissing.push("smartmontools");

  const ups = await getUpsStatus(hostId);

  return { temperatures, disks, ups, toolsMissing };
}
