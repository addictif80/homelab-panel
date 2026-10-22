import { getDb } from "../db";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const FETCH_TIMEOUT_MS = 20_000;

export type CveMatch = {
  id: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low" | null;
  cvssScore: number | null;
  url: string;
};

function getCached(key: string): CveMatch[] | null {
  const row = getDb().prepare(`SELECT cves_json, checked_at FROM vuln_scan_cache WHERE lookup_key = ?`).get(key) as
    | { cves_json: string; checked_at: string }
    | undefined;
  if (!row) return null;
  const ageMs = Date.now() - new Date(`${row.checked_at.replace(" ", "T")}Z`).getTime();
  if (ageMs > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(row.cves_json) as CveMatch[];
  } catch {
    return null;
  }
}

function setCached(key: string, cves: CveMatch[]): void {
  getDb()
    .prepare(
      `INSERT INTO vuln_scan_cache (lookup_key, cves_json, checked_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(lookup_key) DO UPDATE SET cves_json = excluded.cves_json, checked_at = excluded.checked_at`
    )
    .run(key, JSON.stringify(cves));
}

function severityFromScore(score: number | null): CveMatch["severity"] {
  if (score === null) return null;
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

type NvdResponse = {
  vulnerabilities?: {
    cve: {
      id: string;
      descriptions?: { lang: string; value: string }[];
      metrics?: {
        cvssMetricV31?: { cvssData: { baseScore: number } }[];
        cvssMetricV30?: { cvssData: { baseScore: number } }[];
        cvssMetricV2?: { cvssData: { baseScore: number } }[];
      };
    };
  }[];
};

/**
 * Looks up known CVEs for one runtime binary (PHP, Node, MySQL/MariaDB, nginx, Apache, OpenSSH)
 * via NVD's public CPE-applicability match — a versioned CPE given as `cpeName` matches CVEs
 * recorded either against that exact version or via a version range that covers it (NVD does the
 * range matching server-side, not a literal string match), so this catches CVEs filed against a
 * range without needing to fetch and compare ranges ourselves. Filtered to CVSS >= 7 so a runtime
 * scan doesn't drown the user's existing findings in low-severity noise. Cached for a week — see
 * vuln_scan_cache in db.ts — since NVD's free tier (no API key) is rate-limited to 5 requests per
 * rolling 30 seconds, and a given version's CVE list is static between scans anyway.
 */
export async function lookupRuntimeCves(vendor: string, product: string, version: string): Promise<CveMatch[]> {
  const key = `nvd:${vendor}:${product}:${version}`;
  const cached = getCached(key);
  if (cached) return cached;

  const cpeName = `cpe:2.3:a:${vendor}:${product}:${version}:*:*:*:*:*:*:*`;
  const url = `${NVD_BASE}?cpeName=${encodeURIComponent(cpeName)}&cvssV3Severity=HIGH&resultsPerPage=50`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "homelab-panel-vuln-scan" } });
    if (!res.ok) return [];
    const data = (await res.json()) as NvdResponse;
    const cves: CveMatch[] = (data.vulnerabilities ?? [])
      .map(({ cve }) => {
        const score =
          cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ??
          cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore ??
          cve.metrics?.cvssMetricV2?.[0]?.cvssData.baseScore ??
          null;
        return {
          id: cve.id,
          summary: cve.descriptions?.find((d) => d.lang === "en")?.value ?? "",
          severity: severityFromScore(score),
          cvssScore: score,
          url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        };
      })
      .filter((c) => (c.cvssScore ?? 0) >= 7);
    setCached(key, cves);
    return cves;
  } catch {
    // Best-effort, same convention as every other scan category in this panel: NVD being
    // unreachable/rate-limited/slow just means this one software/version comes back with no
    // findings for this scan, not a failed scan overall.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export type PackageRef = { ecosystem: "Packagist" | "npm"; name: string; version: string };

type OsvBatchResponse = {
  results: { vulns?: { id: string; summary?: string; details?: string }[] }[];
};

/** Batch CVE/advisory lookup for app-level dependencies (composer.lock, package-lock.json) via
 * OSV.dev's public, no-auth batch endpoint — one HTTP call for a whole manifest's worth of
 * packages instead of one request each. Returns a map keyed `${name}@${version}`. Each result is
 * cached individually at the same TTL as the runtime lookups above, so a manifest with mostly
 * unchanged dependencies between scans only re-queries what's actually new. */
export async function lookupPackageCves(packages: PackageRef[]): Promise<Map<string, CveMatch[]>> {
  const result = new Map<string, CveMatch[]>();
  const toQuery: PackageRef[] = [];
  for (const pkg of packages) {
    const cached = getCached(`osv:${pkg.ecosystem}:${pkg.name}:${pkg.version}`);
    if (cached) result.set(`${pkg.name}@${pkg.version}`, cached);
    else toQuery.push(pkg);
  }
  if (toQuery.length === 0) return result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OSV_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: toQuery.map((p) => ({ version: p.version, package: { name: p.name, ecosystem: p.ecosystem } })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return result;
    const data = (await res.json()) as OsvBatchResponse;
    data.results.forEach((r, i) => {
      const pkg = toQuery[i];
      const cves: CveMatch[] = (r.vulns ?? []).map((v) => ({
        id: v.id,
        summary: v.summary || v.details?.slice(0, 200) || "",
        severity: null,
        cvssScore: null,
        url: `https://osv.dev/vulnerability/${v.id}`,
      }));
      setCached(`osv:${pkg.ecosystem}:${pkg.name}:${pkg.version}`, cves);
      result.set(`${pkg.name}@${pkg.version}`, cves);
    });
  } catch {
    // Best-effort — see lookupRuntimeCves's own comment.
  } finally {
    clearTimeout(timer);
  }
  return result;
}
