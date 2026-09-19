import { runSshCommand, shellQuote } from "./ssh";

// Each probe below runs sequentially (one disk's smartctl after another) under one outer 20s
// budget (see the health API route) with no cancellation of its own — without a per-call timeout,
// a single hung sudo/profile chain on one disk (or a UPS tool that never returns) could burn the
// whole budget and leave every later probe unattempted. 6s keeps several probes affordable within
// that 20s window while still giving a slow-but-working host room to answer.
const PROBE_TIMEOUT_MS = 6000;

/**
 * SSH-based hardware telemetry — works on the existing fleet (physical boxes without a BMC/IPMI
 * controller included) using whatever monitoring tools are already on the box, rather than
 * requiring IPMI/SNMP credentials to be configured separately. A tool that isn't installed is
 * reported in `toolsMissing` instead of failing the whole call.
 */

export type TemperatureReading = { label: string; celsius: number };
export type DiskHealth = {
  device: string;
  healthy: boolean | null;
  temperatureC: number | null;
  reallocatedSectors: number | null;
  note: string | null;
};
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

/**
 * Only the dedicated "overall-health self-assessment" line is authoritative for PASSED/FAILED —
 * matching the bare word "FAILED" anywhere in smartctl's output (the previous approach) also
 * catches generic error text like "Smartctl: Device Open Failed" or "A mandatory SMART command
 * failed: exiting", which smartctl prints when it simply *can't read* the disk (wrong device type,
 * permissions...) — not when the disk itself is actually failing. That misreading is especially
 * likely on a hardware RAID controller (Dell PERC, HP Smart Array...), where /dev/sdX is a virtual
 * disk smartctl can't query directly without being told the right `-d` type — see
 * getSmartctlTargets() below, which tries to detect that automatically via `smartctl --scan`.
 */
function parseSmart(output: string): { healthy: boolean | null; temperatureC: number | null; reallocatedSectors: number | null; note: string | null } {
  const healthLine = output.match(/overall-health self-assessment test result:\s*(\S+)/i);
  const healthy = healthLine ? /PASSED/i.test(healthLine[1]) : null;
  const tempMatch = output.match(/(?:Temperature_Celsius|Airflow_Temperature_Cel).*?\n?.*?\s(\d+)\s*(?:\(|$)/m);
  const reallocMatch = output.match(/Reallocated_Sector_Ct.*?\s(\d+)\s*$/m);

  let note: string | null = null;
  if (!healthLine) {
    const errorLine = output
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /open failed|command failed|unable to (detect|open|read)|no such device|permission denied/i.test(l));
    note = errorLine || "Impossible de lire l'état SMART (type de périphérique non détecté).";
  }

  return {
    healthy,
    temperatureC: tempMatch ? Number(tempMatch[1]) : null,
    reallocatedSectors: reallocMatch ? Number(reallocMatch[1]) : null,
    note,
  };
}

async function getUpsStatus(hostId: number): Promise<UpsStatus | null> {
  const list = await runSshCommand(hostId, "upsc -l 2>/dev/null", { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  const upsName = list?.code === 0 ? list.stdout.trim().split("\n")[0] : "";
  if (upsName) {
    const detail = await runSshCommand(hostId, `upsc ${shellQuote(upsName)} 2>/dev/null`, { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
    if (detail?.stdout) {
      const status = detail.stdout.match(/^ups\.status:\s*(.+)$/m)?.[1]?.trim();
      const charge = detail.stdout.match(/^battery\.charge:\s*([\d.]+)/m)?.[1];
      if (status) return { status, chargePercent: charge ? Math.round(Number(charge)) : null };
    }
  }

  const apc = await runSshCommand(hostId, "apcaccess status 2>/dev/null", { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  if (apc?.code === 0 && apc.stdout.trim()) {
    const status = apc.stdout.match(/^STATUS\s*:\s*(.+)$/m)?.[1]?.trim();
    const charge = apc.stdout.match(/^BCHARGE\s*:\s*([\d.]+)/m)?.[1];
    if (status) return { status, chargePercent: charge ? Math.round(Number(charge)) : null };
  }

  return null;
}

type SmartTarget = { device: string; label: string; typeArg: string | null };

/**
 * `smartctl --scan` asks smartctl itself which `-d TYPE` each device needs — the right way to
 * reach a disk sitting behind a hardware RAID controller (Dell PERC, HP Smart Array, LSI
 * MegaRAID...), where a plain `smartctl -H /dev/sda` talks to the RAID controller's own virtual
 * disk instead of the physical drive and fails to read anything meaningful. Falls back to plain
 * lsblk enumeration (no `-d` type) when `--scan` finds nothing, which still works for ordinary
 * direct-attached disks.
 */
async function getSmartctlTargets(hostId: number): Promise<SmartTarget[]> {
  const scanRes = await runSshCommand(hostId, "smartctl --scan 2>/dev/null", { sudo: true, timeoutMs: PROBE_TIMEOUT_MS }).catch(
    () => null
  );
  if (scanRes?.code === 0 && scanRes.stdout.trim()) {
    const scanned = scanRes.stdout
      .split("\n")
      .map((line) => line.match(/^(\S+)\s+-d\s+(\S+)/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ device: m[1], label: m[1].replace(/^\/dev\//, ""), typeArg: m[2] }));
    if (scanned.length > 0) return scanned;
  }

  const lsblkRes = await runSshCommand(hostId, "lsblk -d -n -o NAME,TYPE 2>/dev/null", { timeoutMs: PROBE_TIMEOUT_MS }).catch(
    () => null
  );
  return (lsblkRes?.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(" disk") || l.endsWith("\tdisk"))
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean)
    .map((name) => ({ device: `/dev/${name}`, label: name, typeArg: null }));
}

export async function getHardwareHealth(hostId: number): Promise<HardwareHealth> {
  const toolsMissing: string[] = [];

  const sensorsRes = await runSshCommand(hostId, "sensors -u 2>/dev/null", { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  const temperatures = sensorsRes?.code === 0 && sensorsRes.stdout.trim() ? parseSensors(sensorsRes.stdout) : [];
  if (temperatures.length === 0) toolsMissing.push("lm-sensors");

  const disks: DiskHealth[] = [];
  const targets = await getSmartctlTargets(hostId);

  let smartAvailable = false;
  for (const target of targets) {
    const typeFlag = target.typeArg ? `-d ${shellQuote(target.typeArg)} ` : "";
    const smart = await runSshCommand(hostId, `smartctl -H -A ${typeFlag}${shellQuote(target.device)} 2>&1`, {
      sudo: true,
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => null);
    if (!smart || smart.code === 127 || /command not found|not recognized/i.test(smart.stderr || "")) continue;
    smartAvailable = true;
    disks.push({ device: target.label, ...parseSmart(smart.stdout) });
  }
  if (!smartAvailable) toolsMissing.push("smartmontools");

  const ups = await getUpsStatus(hostId);

  return { temperatures, disks, ups, toolsMissing };
}
