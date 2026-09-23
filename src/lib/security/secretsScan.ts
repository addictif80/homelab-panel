import { runSshCommand } from "../ssh";
import { withTimeout } from "../timeout";
import type { Finding } from "./types";

const SCAN_TIMEOUT_MS = 25_000;
const MAX_FILES = 200;

// A handful of well-known filenames that commonly carry live credentials in plaintext, searched
// under the directories self-hosted stacks actually live in — never the whole filesystem (slow,
// and floods results with irrelevant system files). node_modules/.git are excluded since a
// vendored .env.example or a committed (already-known-safe) sample inside a git-tracked path is
// noise, not a finding — this scans the live filesystem, not source control, which is the whole
// point of the feature (a checked-in secret has its own well-known tooling; a secret sitting
// readable on the actual running server, found by nobody, is the gap this fills).
const SEARCH_ROOTS = ["/opt", "/srv", "/home", "/root", "/var/www"];
const SECRET_FILENAMES = [
  ".env",
  ".env.*",
  "docker-compose.yml",
  "docker-compose.yaml",
  "wp-config.php",
  "credentials.json",
  "settings.py",
  "*.pem",
  "id_rsa",
];
const KEY_PATTERN = "(PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*[[:space:]]*[:=]";
const WEB_ROOT_HINT = /\/var\/www|\/public\/|\/html\//;

const FILE_MARKER = "===HLP_SECRET_FILE===";

function findCommand(): string {
  const nameClauses = SECRET_FILENAMES.map((n) => `-iname ${JSON.stringify(n)}`).join(" -o ");
  const roots = SEARCH_ROOTS.join(" ");
  return `find ${roots} -maxdepth 6 \\( ${nameClauses} \\) -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -${MAX_FILES}`;
}

function scanScript(): string {
  return [
    `for f in $(${findCommand()}); do`,
    `  echo "${FILE_MARKER}"`,
    `  echo "$f"`,
    `  stat -c '%a' "$f" 2>/dev/null || echo '?'`,
    `  if [ "$(basename "$f")" = "id_rsa" ] || [ "\${f##*.}" = "pem" ]; then`,
    `    echo 'PRIVATE_KEY_FILE'`,
    `  else`,
    `    grep -Eo '${KEY_PATTERN}' "$f" 2>/dev/null | sort -u | tr '\\n' ',' `,
    `    echo`,
    `  fi`,
    `done`,
  ].join("\n");
}

type FoundFile = { path: string; perm: string; keys: string[]; isPrivateKey: boolean };

function parseScanOutput(stdout: string): FoundFile[] {
  const blocks = stdout.split(FILE_MARKER).slice(1);
  const files: FoundFile[] = [];
  for (const block of blocks) {
    // Each block is "\n<path>\n<perm>\n<keys-or-marker>\n" — trim() drops the leading/trailing
    // newlines from the echo commands so line 0 is really the path, not an empty string.
    const lines = block.trim().split("\n");
    const path = lines[0]?.trim();
    const perm = lines[1]?.trim() ?? "?";
    const rest = lines[2]?.trim() ?? "";
    if (!path) continue;
    if (rest === "PRIVATE_KEY_FILE") {
      files.push({ path, perm, keys: [], isPrivateKey: true });
    } else {
      const keys = rest.split(",").map((k) => k.trim()).filter(Boolean);
      if (keys.length > 0) files.push({ path, perm, keys, isPrivateKey: false });
    }
  }
  return files;
}

function isWorldReadable(perm: string): boolean {
  const last = perm.at(-1);
  return last !== undefined && Number(last) >= 4;
}

/**
 * Looks for secrets sitting exposed on the *live* filesystem of a real server — not in a Git
 * repository, which already has plenty of dedicated scanners (gitleaks, trufflehog...). The gap
 * this fills is different: a `.env` a script dropped in `/opt/app` years ago, still world-readable,
 * that nobody's git history ever saw because it was never committed anywhere.
 *
 * Reports only the *variable name* that looks secret-shaped (PASSWORD=, API_KEY=...), never the
 * value — this finding has to be safe to show in the panel's UI and store in its own database
 * without becoming a second place the secret now lives unencrypted.
 */
export async function secretsExposureFindings(hostId: number): Promise<Finding[]> {
  let stdout: string;
  try {
    const result = await withTimeout(
      runSshCommand(hostId, scanScript(), { sudo: true }),
      SCAN_TIMEOUT_MS,
      "Délai dépassé lors de la recherche de secrets exposés."
    );
    stdout = result.stdout;
  } catch {
    return [];
  }

  const files = parseScanOutput(stdout);
  const findings: Finding[] = [];

  for (const file of files) {
    const webExposed = WEB_ROOT_HINT.test(file.path);
    const worldReadable = isWorldReadable(file.perm);

    if (file.isPrivateKey) {
      findings.push({
        id: `secret-privkey-${file.path}`,
        category: "diagnostics",
        severity: webExposed || worldReadable ? "critical" : "warning",
        title: `Clé privée trouvée : ${file.path}`,
        detail:
          `Une clé privée (permissions ${file.perm}) traîne à cet emplacement` +
          (worldReadable ? ", lisible par n'importe quel utilisateur du système" : "") +
          (webExposed ? ", dans un dossier potentiellement servi publiquement par un serveur web" : "") +
          `. Action recommandée : déplace-la vers un emplacement standard (~/.ssh) avec des permissions 600, ou révoque-la si elle n'a plus d'usage.`,
        howTo: [`chmod 600 ${file.path}`, `# Si cette clé n'est plus utilisée, régénère et révoque-la côté service concerné.`],
      });
      continue;
    }

    if (file.keys.length === 0) continue;
    findings.push({
      id: `secret-exposed-${file.path}`,
      category: "diagnostics",
      severity: webExposed ? "critical" : worldReadable ? "warning" : "info",
      title: `Secrets potentiels dans ${file.path}`,
      detail:
        `Variable(s) au nom évocateur trouvée(s) : ${file.keys.join(", ")} (valeurs jamais lues ni affichées ici). ` +
        `Permissions actuelles : ${file.perm}` +
        (webExposed ? " — ce dossier semble servi par un serveur web, donc potentiellement accessible depuis l'extérieur." : ".") +
        ` Action recommandée : vérifie que ce fichier n'est accessible qu'au compte qui en a besoin (chmod 600) et qu'il n'est jamais servi par le serveur web.`,
      howTo: [`chmod 600 ${file.path}`, `ls -la ${file.path}`],
    });
  }

  return findings;
}
