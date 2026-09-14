import { runSshCommand } from "../ssh";
import { withTimeout } from "../timeout";
import type { Finding } from "./types";

const DIAG_TIMEOUT_MS = 20_000;
const JOURNAL_ERROR_LINES = 300;
const JOURNAL_PROCESS_MIN_COUNT = 5;
const DISK_WARNING_PCT = 90;
const DISK_CRITICAL_PCT = 95;

const SEP_FAILED = "===HOMELAB_FAILED_UNITS===";
const SEP_JOURNAL = "===HOMELAB_JOURNAL_ERRORS===";
const SEP_OOM = "===HOMELAB_OOM===";
const SEP_DISK = "===HOMELAB_DISK===";
const SEP_DOCKER = "===HOMELAB_DOCKER===";

const DIAG_COMMAND = [
  `echo '${SEP_FAILED}'`,
  `systemctl --failed --no-legend --plain 2>/dev/null`,
  `echo '${SEP_JOURNAL}'`,
  `journalctl -p 3 -n ${JOURNAL_ERROR_LINES} --no-pager -o short 2>/dev/null`,
  `echo '${SEP_OOM}'`,
  `dmesg 2>/dev/null | grep -iE 'killed process|out of memory' | tail -20`,
  `echo '${SEP_DISK}'`,
  `df -hP 2>/dev/null | tail -n +2`,
  `echo '${SEP_DOCKER}'`,
  `command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}|{{.Status}}' 2>/dev/null`,
].join("\n");

function extractSection(output: string, startMarker: string, endMarker: string | null): string[] {
  const startIdx = output.indexOf(startMarker);
  if (startIdx === -1) return [];
  const from = startIdx + startMarker.length;
  const to = endMarker ? output.indexOf(endMarker, from) : output.length;
  const body = to === -1 ? output.slice(from) : output.slice(from, to);
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function failedUnitFindings(lines: string[]): Finding[] {
  return lines.map((l) => {
    const unit = l.split(/\s+/)[0];
    return {
      id: `systemd-failed-${unit}`,
      category: "diagnostics",
      severity: "critical",
      title: `Service "${unit}" en échec (systemd)`,
      detail: `systemctl rapporte ce service comme étant en échec. Action recommandée : consulter ses logs pour comprendre pourquoi il ne démarre pas, puis le relancer.`,
      howTo: [`sudo systemctl status ${unit}`, `sudo journalctl -u ${unit} -n 50 --no-pager`, `sudo systemctl restart ${unit}`],
    };
  });
}

const JOURNAL_LINE_RE = /^\S+\s+\d+\s+\S+\s+\S+\s+([^:\[]+?)(\[\d+\])?:\s*(.*)$/;

function journalErrorFindings(lines: string[]): Finding[] {
  const byProcess = new Map<string, { count: number; sample: string }>();
  for (const l of lines) {
    const match = l.match(JOURNAL_LINE_RE);
    const process = match ? match[1].trim() : "système";
    const message = match ? match[3] : l;
    const entry = byProcess.get(process) ?? { count: 0, sample: message };
    entry.count += 1;
    entry.sample = message;
    byProcess.set(process, entry);
  }

  const findings: Finding[] = [];
  for (const [process, { count, sample }] of byProcess) {
    if (count < JOURNAL_PROCESS_MIN_COUNT) continue;
    findings.push({
      id: `journal-errors-${process}`,
      category: "diagnostics",
      severity: count >= 30 ? "critical" : "warning",
      title: `Erreurs répétées du service "${process}" (${count} dans le journal système)`,
      detail: `Dernier message : "${sample.slice(0, 300)}". Action recommandée : consulter le journal complet de ce service pour identifier la cause.`,
      howTo: [`sudo journalctl -u ${process} -p err -n 50 --no-pager`, `sudo journalctl -n 100 --no-pager | grep -i ${process}`],
    });
  }
  return findings;
}

function oomFindings(lines: string[]): Finding[] {
  if (lines.length === 0) return [];
  const processes = new Set<string>();
  for (const l of lines) {
    const match = l.match(/killed process\s+\d+\s+\(([^)]+)\)/i);
    if (match) processes.add(match[1]);
  }
  const who = processes.size > 0 ? [...processes].join(", ") : "un ou plusieurs processus";
  return [
    {
      id: "oom-kill",
      category: "diagnostics",
      severity: "critical",
      title: "Le noyau a tué des processus par manque de mémoire (OOM killer)",
      detail: `Processus concerné(s) : ${who}. Ça arrive quand la machine n'a plus assez de RAM libre. Action recommandée : vérifier la consommation mémoire, ajouter du swap si besoin, ou augmenter la RAM disponible.`,
      howTo: ["free -h", "sudo dmesg | grep -i 'killed process' | tail -20", "# Ajouter du swap si la machine n'en a pas :", "sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"],
    },
  ];
}

function diskFindings(lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const l of lines) {
    const match = l.match(/(\d+)%\s+(\/\S*)$/);
    if (!match) continue;
    const pct = parseInt(match[1], 10);
    const mount = match[2];
    if (pct < DISK_WARNING_PCT) continue;
    if (mount.startsWith("/snap") || mount.startsWith("/boot/efi")) continue;
    findings.push({
      id: `disk-full-${mount}`,
      category: "diagnostics",
      severity: pct >= DISK_CRITICAL_PCT ? "critical" : "warning",
      title: `Disque presque plein (${pct}%) sur "${mount}"`,
      detail: `Un disque plein bloque les écritures (bases de données, logs, mises à jour...) et peut planter des services sans prévenir. Action recommandée : identifier ce qui prend de la place et libérer de l'espace.`,
      howTo: ["df -h", `du -xsh ${mount}/* 2>/dev/null | sort -rh | head -20`],
    });
  }
  return findings;
}

function dockerHealthFindings(lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const l of lines) {
    const [name, status] = l.split("|");
    if (!name || !status) continue;
    if (/restarting/i.test(status)) {
      findings.push({
        id: `docker-restart-${name}`,
        category: "diagnostics",
        severity: "warning",
        title: `Le conteneur "${name}" redémarre en boucle`,
        detail: `Statut Docker actuel : "${status}". Un conteneur qui redémarre sans arrêt plante généralement au démarrage à cause d'une erreur de configuration ou d'une dépendance indisponible. Action recommandée : consulter ses logs.`,
        howTo: [`docker logs --tail 50 ${name}`, `docker inspect ${name} --format '{{json .State}}'`],
      });
      continue;
    }
    const exitMatch = status.match(/^Exited \((\d+)\)\s+(.*)$/i);
    // Only flag a recent, unexpected exit — a container someone stopped on purpose days ago
    // shouldn't nag forever. Docker's relative "X ago" suffix makes this cheap to approximate:
    // skip anything phrased in days/weeks/months/years.
    const recentExit = exitMatch && !/\b(day|week|month|year)s?\s+ago/i.test(exitMatch[2]);
    if (exitMatch && exitMatch[1] !== "0" && recentExit) {
      findings.push({
        id: `docker-exit-${name}`,
        category: "diagnostics",
        severity: "warning",
        title: `Le conteneur "${name}" s'est arrêté avec une erreur (code ${exitMatch[1]})`,
        detail: `Statut Docker actuel : "${status}". Action recommandée : consulter ses logs avant de le relancer pour comprendre pourquoi il s'est arrêté.`,
        howTo: [`docker logs --tail 50 ${name}`, `docker start ${name}`],
      });
    }
  }
  return findings;
}

/**
 * Reads a mix of systemd, kernel, disk and Docker signals over one SSH round-trip and turns them
 * into plain-language findings — the generic complement to historicalLogFindings (which only
 * looks at the configured web/mail log sources): this covers "what's broken on the machine
 * itself" for any SSH-reachable host, physical or virtual, regardless of what's running on it.
 * A host with no matching tooling (OpenWrt has no systemd/docker, e.g.) just yields empty
 * sections and no findings — nothing here assumes a particular OS beyond "has an SSH shell".
 */
export async function hostDiagnosticsFindings(hostId: number): Promise<Finding[]> {
  let stdout: string;
  try {
    const result = await withTimeout(
      runSshCommand(hostId, DIAG_COMMAND, { sudo: true }),
      DIAG_TIMEOUT_MS,
      "Délai dépassé lors du diagnostic système."
    );
    stdout = result.stdout;
  } catch {
    return [];
  }

  const failedUnits = extractSection(stdout, SEP_FAILED, SEP_JOURNAL);
  const journalErrors = extractSection(stdout, SEP_JOURNAL, SEP_OOM);
  const oomLines = extractSection(stdout, SEP_OOM, SEP_DISK);
  const diskLines = extractSection(stdout, SEP_DISK, SEP_DOCKER);
  const dockerLines = extractSection(stdout, SEP_DOCKER, null);

  return [
    ...failedUnitFindings(failedUnits),
    ...journalErrorFindings(journalErrors),
    ...oomFindings(oomLines),
    ...diskFindings(diskLines),
    ...dockerHealthFindings(dockerLines),
  ];
}
