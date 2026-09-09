export type SuspiciousReason = "auth_failure" | "not_found_scan" | "high_volume";

export type IpSuggestion = {
  ip: string;
  reasons: SuspiciousReason[];
  counts: { authFailure: number; notFound: number; total: number };
};

const REASON_LABELS: Record<SuspiciousReason, string> = {
  auth_failure: "échecs d'authentification répétés",
  not_found_scan: "scan d'URLs inexistantes (404 en rafale)",
  high_volume: "volume de requêtes anormal",
};

export function reasonLabel(reason: SuspiciousReason): string {
  return REASON_LABELS[reason];
}

// Heuristic thresholds over the lines currently in view (the live tail buffer, not a fixed
// time window) — generous enough to avoid flagging normal traffic on a small homelab.
const AUTH_FAILURE_THRESHOLD = 5;
const NOT_FOUND_THRESHOLD = 20;
const HIGH_VOLUME_THRESHOLD = 200;

const IPV4_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const AUTH_FAILURE_RE =
  /authentication failed|auth failure|sasl login authentication failed|failed password|invalid user|failed publickey|too many authentication failures/i;

function extractIp(line: string): string | null {
  const match = line.match(IPV4_RE);
  if (!match) return null;
  // Skip private/loopback ranges — blocking those would be pointless or self-harming.
  const [a, b] = match[1].split(".").map(Number);
  if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return null;
  }
  return match[1];
}

function extractStatusCode(line: string): number | null {
  // Matches the status code in a typical combined/common log format line: `"GET / HTTP/1.1" 404 123`
  const match = line.match(/"\s+(\d{3})\s+\d+/);
  return match ? parseInt(match[1], 10) : null;
}

/** Scans a batch of log lines and returns IPs worth suggesting a block for, with why. */
export function analyzeLogLines(lines: string[]): IpSuggestion[] {
  const stats = new Map<string, { authFailure: number; notFound: number; total: number }>();

  for (const line of lines) {
    const ip = extractIp(line);
    if (!ip) continue;

    const entry = stats.get(ip) ?? { authFailure: 0, notFound: 0, total: 0 };
    entry.total += 1;

    if (AUTH_FAILURE_RE.test(line)) entry.authFailure += 1;
    const status = extractStatusCode(line);
    if (status === 401 || status === 403) entry.authFailure += 1;
    if (status === 404) entry.notFound += 1;

    stats.set(ip, entry);
  }

  const suggestions: IpSuggestion[] = [];
  for (const [ip, counts] of stats) {
    const reasons: SuspiciousReason[] = [];
    if (counts.authFailure >= AUTH_FAILURE_THRESHOLD) reasons.push("auth_failure");
    if (counts.notFound >= NOT_FOUND_THRESHOLD) reasons.push("not_found_scan");
    if (counts.total >= HIGH_VOLUME_THRESHOLD) reasons.push("high_volume");
    if (reasons.length > 0) suggestions.push({ ip, reasons, counts });
  }

  return suggestions.sort((a, b) => b.counts.total - a.counts.total);
}
