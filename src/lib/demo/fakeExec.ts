import { getDb } from "../db";
import { DEMO_CONTAINERS } from "./seedDemo";

type ExecResult = { stdout: string; stderr: string; code: number };

/** Deterministic-ish but slightly varying fake fleet stats per host, so the dashboard doesn't look
 * frozen/fake on repeat visits within the same session — seeded off the host id so each machine
 * keeps a stable "personality" (e.g. the NAS always reads busier than a fresh VPS). */
function fakeStats(hostId: number): { cores: number; memTotalKb: number; memAvailKb: number; diskTotalKb: number; diskUsedKb: number; idlePercent: number } {
  const wobble = (Date.now() / 60_000 + hostId) % 10; // slow drift, changes every ~6s of wall time
  const cores = [4, 8, 4, 2, 2, 1][hostId % 6] ?? 4;
  const memTotalKb = cores * 4_000_000;
  const usedFraction = 0.3 + hostId * 0.07 + wobble * 0.01;
  const memAvailKb = Math.round(memTotalKb * (1 - Math.min(usedFraction, 0.85)));
  const diskTotalKb = 500_000_000 + hostId * 120_000_000;
  const diskUsedKb = Math.round(diskTotalKb * (0.25 + hostId * 0.08));
  const idlePercent = Math.max(5, 90 - hostId * 8 - wobble);
  return { cores, memTotalKb, memAvailKb, diskTotalKb, diskUsedKb, idlePercent };
}

function findDemoContainer(containerId: string): { name: string; image: string } | null {
  for (const containers of Object.values(DEMO_CONTAINERS)) {
    const match = containers.find((c) => c.id === containerId);
    if (match) return { name: match.name, image: match.image };
  }
  return null;
}

/** A `docker inspect` result plausible enough to drive the demo's service-resurrection flow end to
 * end — one named volume, an image/restart policy, no real ports — not a faithful reproduction of
 * dockerPsJson's richer per-host container list above. */
function fakeDockerInspect(containerId: string): string {
  const known = findDemoContainer(containerId);
  const name = known?.name ?? `conteneur-${containerId.slice(0, 8)}`;
  const image = known?.image ?? "demo/app:latest";
  return JSON.stringify([
    {
      Name: `/${name}`,
      Config: { Image: image, Env: ["TZ=Europe/Paris"], Cmd: null },
      HostConfig: { RestartPolicy: { Name: "unless-stopped" }, PortBindings: {} },
      Mounts: [
        { Type: "volume", Name: `${name}_data`, Source: `/var/lib/docker/volumes/${name}_data/_data`, Destination: "/data" },
      ],
    },
  ]);
}

function hostSlug(hostId: number): string | null {
  const row = getDb().prepare(`SELECT slug FROM hosts WHERE id = ?`).get(hostId) as { slug: string } | undefined;
  return row?.slug ?? null;
}

function dockerPsJson(hostId: number): string {
  const slug = hostSlug(hostId);
  const containers = (slug && DEMO_CONTAINERS[slug]) || [];
  return containers
    .map((c) =>
      JSON.stringify({
        ID: c.id,
        Names: c.name,
        Image: c.image,
        Status: c.status,
        State: c.state,
        Ports: c.ports,
        CreatedAt: "2025-01-01 00:00:00 +0000 UTC",
      })
    )
    .join("\n");
}

function monitoringStats(hostId: number): string {
  const s = fakeStats(hostId);
  return [
    `CORES:${s.cores}`,
    `MEMTOTAL:${s.memTotalKb}`,
    `MEMAVAIL:${s.memAvailKb}`,
    `DISK:${s.diskTotalKb} ${s.diskUsedKb}`,
    `CPULINE:%Cpu(s):  ${(100 - s.idlePercent).toFixed(1)} us,  0.0 sy,  0.0 ni, ${s.idlePercent.toFixed(1)} id`,
  ].join("\n");
}

/**
 * Every SSH command the app would otherwise run against a real host, faked. Only the handful of
 * commands that drive the flagship demo pages (dashboard stats, Docker) get realistic tailored
 * output; anything else (hardware sensors, backup file listing, discovery scans...) returns a
 * harmless empty success instead of erroring, so a page that isn't specifically simulated still
 * renders its normal empty state rather than crashing.
 */
export function fakeExec(hostId: number, rawCommand: string): ExecResult {
  if (rawCommand.includes("docker ps -a --format")) {
    const markerMatch = rawCommand.match(/^echo (\S+);/);
    const marker = markerMatch ? markerMatch[1] : "";
    return { stdout: marker ? `${marker}\n${dockerPsJson(hostId)}` : dockerPsJson(hostId), stderr: "", code: 0 };
  }

  if (rawCommand.includes("CORES:$(nproc)")) {
    return { stdout: monitoringStats(hostId), stderr: "", code: 0 };
  }

  const inspectMatch = rawCommand.match(/^docker inspect '([^']+)'/);
  if (inspectMatch) {
    return { stdout: fakeDockerInspect(inspectMatch[1]), stderr: "", code: 0 };
  }

  const restoredInspectMatch = rawCommand.match(/^cat '[^']*homelab-panel-inspect-([^']+)\.json'/);
  if (restoredInspectMatch) {
    return { stdout: fakeDockerInspect(restoredInspectMatch[1]), stderr: "", code: 0 };
  }

  if (rawCommand.includes("SHOW DATABASES")) {
    // "Tester la connexion" (lib/backup/sources/database.ts) — a plausible fake list so the demo
    // shows the real UI (checkboxes for real-looking database names) rather than an empty result.
    return { stdout: "information_schema\nnextcloud\nnpm\nwordpress_prod", stderr: "", code: 0 };
  }
  if (rawCommand.includes("SELECT datname FROM pg_database")) {
    return { stdout: "postgres\nghost\nvaultwarden", stderr: "", code: 0 };
  }

  if (rawCommand.includes("command -v rsync")) {
    // Both the plain availability check and the nested "does the destination reach rsync over
    // the backup key" check (lib/backup/transfer.ts) need non-empty stdout to read as success —
    // a fake filesystem has no real rsync to find, but a demo backup shouldn't fail over it.
    return { stdout: "/usr/bin/rsync", stderr: "", code: 0 };
  }

  if (rawCommand.includes("-type f 2>/dev/null | wc -l")) {
    // A restoration drill's file count check (lib/backup/drill.ts): the scratch directory it
    // restores into always "wins" against the snapshot's own count, so a demo drill reliably
    // shows success rather than a coin flip on fake numbers that don't actually correspond to
    // any real transfer in demo mode.
    return { stdout: rawCommand.includes("homelab-panel-drill-") ? "500" : "40", stderr: "", code: 0 };
  }

  if (rawCommand.includes("___KEYPATH___")) {
    return { stdout: "___KEYPATH___/home/demo/.ssh/homelab_panel_backup_key", stderr: "", code: 0 };
  }

  if (rawCommand.includes("___THROUGHPUT_NS___")) {
    // A believable, slightly-varying Mb/s per (source, target) pair — LAN-speed range, not a real
    // measurement, purely so the demo's throughput matrix doesn't show identical numbers everywhere.
    const targetMatch = rawCommand.match(/@[\w.-]+\s*"cat/);
    const seed = hostId * 7 + (targetMatch ? targetMatch[0].length : 0);
    const wobble = (Date.now() / 60_000 + seed) % 10;
    const mbps = 180 + ((seed * 53) % 650) + wobble * 5;
    const elapsedNs = Math.round((64 * 8 * 1e9) / mbps);
    return { stdout: `___THROUGHPUT_NS___${elapsedNs}`, stderr: "", code: 0 };
  }

  return { stdout: "", stderr: "", code: 0 };
}
