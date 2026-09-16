import { getDb } from "./db";
import { getProxyHost, updateProxyHost, type ProxyHost } from "./npm";

/**
 * Automatic web failover for an NPM proxy host, implemented as a pure nginx-level mechanism
 * rather than a scheduler that rewrites NPM's config on every check: NPM's "Advanced" tab content
 * is inserted inside the *server* block of the generated config, where an `upstream {}` block
 * (nginx's usual failover primitive) isn't allowed — it belongs in the http context, which NPM
 * doesn't expose per-host. The reliable, well-documented workaround that stays entirely inside one
 * server block: keep the primary target exactly as already configured (untouched, still served by
 * NPM's own default location), and add a server-level `error_page`+named-location fallback that
 * nginx follows itself, immediately, whenever the primary answers with a 502/503/504 — no separate
 * process needs to notice the outage or edit anything for the failover itself to happen.
 *
 * Two fallback modes: proxy to a real backup server, or serve a custom static maintenance page —
 * the latter is inlined directly into the generated nginx snippet via `return 200 '...'` rather
 * than requiring a file on disk. That's deliberate: NPM is only ever reached through its own REST
 * API here (see lib/npm.ts), with no assumption that this panel has SSH/filesystem access to
 * whatever host actually runs it, so a page referencing a file path on that host isn't an option.
 *
 * The health-check scheduler (lib/npmFailoverScheduler.ts) is therefore *not* what performs the
 * failover — it only probes the primary (and, in server mode, the backup) periodically to keep a
 * status ("primaire actif" / "basculé sur le secours" / "erreur") for display, independent of
 * nginx's own real-time behavior.
 */

const MARKER_START = "# BEGIN homelab-panel-failover — generated, do not edit inside these markers";
const MARKER_END = "# END homelab-panel-failover";
const LOCATION_NAME = "@homelab_failover_backup";

export type FailoverBackup =
  | { mode: "server"; scheme: "http" | "https"; host: string; port: number }
  | { mode: "page"; html: string };

/** Escapes HTML for safe embedding inside a single-quoted nginx string literal: backslashes and
 * single quotes need escaping so they don't break out of the quote, and a literal `$` needs
 * escaping too, or nginx tries to interpolate it as the start of a variable reference. NPM
 * validates the resulting config server-side before applying it (same safety net as any other
 * update through this panel) — a mistake here surfaces as a rejected save, not a broken live site. */
function escapeForNginxString(html: string): string {
  return html.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
}

function buildSnippet(backup: FailoverBackup): string {
  if (backup.mode === "page") {
    return [
      MARKER_START,
      "proxy_intercept_errors on;",
      `error_page 502 503 504 = ${LOCATION_NAME};`,
      `location ${LOCATION_NAME} {`,
      "  internal;",
      "  default_type text/html;",
      `  return 200 '${escapeForNginxString(backup.html)}';`,
      "}",
      MARKER_END,
    ].join("\n");
  }

  return [
    MARKER_START,
    "proxy_intercept_errors on;",
    `error_page 502 503 504 = ${LOCATION_NAME};`,
    `location ${LOCATION_NAME} {`,
    "  internal;",
    `  proxy_pass ${backup.scheme}://${backup.host}:${backup.port};`,
    "  proxy_set_header Host $host;",
    "  proxy_set_header X-Real-IP $remote_addr;",
    "  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "  proxy_set_header X-Forwarded-Proto $scheme;",
    "}",
    MARKER_END,
  ].join("\n");
}

/** Strips any prior homelab-panel-failover block from `existing` (so re-applying or removing
 * never duplicates/leaves stale copies) and appends the new one, if given — preserving everything
 * else the user or NPM's own UI put in the Advanced tab, which the pre-existing update code used
 * to silently discard on every save. */
function mergeAdvancedConfig(existing: string, snippet: string | null): string {
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const withoutOurBlock =
    startIdx !== -1 && endIdx !== -1
      ? (existing.slice(0, startIdx) + existing.slice(endIdx + MARKER_END.length)).trim()
      : existing.trim();

  if (!snippet) return withoutOurBlock;
  return withoutOurBlock ? `${withoutOurBlock}\n\n${snippet}` : snippet;
}

export type FailoverConfig = {
  proxyHostId: number;
  mode: "server" | "page";
  backupScheme: "http" | "https";
  backupHost: string;
  backupPort: number;
  maintenanceHtml: string | null;
  enabled: boolean;
  lastStatus: "unknown" | "primary" | "failover" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
};

type FailoverRow = {
  proxy_host_id: number;
  mode: "server" | "page";
  backup_scheme: "http" | "https";
  backup_host: string;
  backup_port: number;
  maintenance_html: string | null;
  enabled: number;
  last_status: FailoverConfig["lastStatus"];
  last_checked_at: string | null;
  last_error: string | null;
};

function rowToConfig(row: FailoverRow): FailoverConfig {
  return {
    proxyHostId: row.proxy_host_id,
    mode: row.mode,
    backupScheme: row.backup_scheme,
    backupHost: row.backup_host,
    backupPort: row.backup_port,
    maintenanceHtml: row.maintenance_html,
    enabled: row.enabled === 1,
    lastStatus: row.last_status,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

export function getFailoverConfig(proxyHostId: number): FailoverConfig | null {
  const row = getDb().prepare(`SELECT * FROM proxy_failovers WHERE proxy_host_id = ?`).get(proxyHostId) as
    | FailoverRow
    | undefined;
  return row ? rowToConfig(row) : null;
}

export function listFailoverConfigs(): FailoverConfig[] {
  return (getDb().prepare(`SELECT * FROM proxy_failovers`).all() as FailoverRow[]).map(rowToConfig);
}

async function pushAdvancedConfig(host: ProxyHost, snippet: string | null): Promise<void> {
  const advancedConfig = mergeAdvancedConfig(host.advancedConfig, snippet);
  await updateProxyHost(host.id, {
    domainNames: host.domainNames,
    forwardScheme: host.forwardScheme,
    forwardHost: host.forwardHost,
    forwardPort: host.forwardPort,
    sslForced: host.sslForced,
    certificateId: host.certificateId,
    advancedConfig,
  });
}

export async function applyFailover(proxyHostId: number, backup: FailoverBackup): Promise<void> {
  const host = await getProxyHost(proxyHostId);
  const snippet = buildSnippet(backup);
  await pushAdvancedConfig(host, snippet);

  getDb()
    .prepare(
      `INSERT INTO proxy_failovers (proxy_host_id, mode, backup_scheme, backup_host, backup_port, maintenance_html, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(proxy_host_id) DO UPDATE SET
         mode = excluded.mode,
         backup_scheme = excluded.backup_scheme,
         backup_host = excluded.backup_host,
         backup_port = excluded.backup_port,
         maintenance_html = excluded.maintenance_html,
         enabled = 1`
    )
    .run(
      proxyHostId,
      backup.mode,
      backup.mode === "server" ? backup.scheme : "http",
      backup.mode === "server" ? backup.host : "",
      backup.mode === "server" ? backup.port : 0,
      backup.mode === "page" ? backup.html : null
    );
}

export async function removeFailover(proxyHostId: number): Promise<void> {
  const host = await getProxyHost(proxyHostId);
  await pushAdvancedConfig(host, null);
  getDb().prepare(`DELETE FROM proxy_failovers WHERE proxy_host_id = ?`).run(proxyHostId);
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function probe(scheme: string, host: string, port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      // Any HTTP response at all (even a 4xx/5xx from the app itself) means the server is up and
      // answering — only a connection failure/timeout counts as "down" for failover purposes,
      // since that's the same condition nginx's own error_page fallback reacts to.
      await fetch(`${scheme}://${host}:${port}/`, { signal: controller.signal, redirect: "manual" });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Best-effort visibility only — see the module comment for why this never touches NPM's config
 * itself. One host's check failing (unreachable target, DNS hiccup) never blocks the others. In
 * 'page' mode there's no backup server to probe — a down primary always means the (always
 * "available") static page is what's being served, so status is a simple primary/failover. */
export async function checkAllFailovers(): Promise<void> {
  const configs = listFailoverConfigs().filter((c) => c.enabled);
  await Promise.all(
    configs.map(async (config) => {
      try {
        const host = await getProxyHost(config.proxyHostId);
        const primaryUp = await probe(host.forwardScheme, host.forwardHost, host.forwardPort);
        const status = primaryUp
          ? "primary"
          : config.mode === "page"
            ? "failover"
            : (await probe(config.backupScheme, config.backupHost, config.backupPort))
              ? "failover"
              : "error";
        getDb()
          .prepare(`UPDATE proxy_failovers SET last_status = ?, last_checked_at = datetime('now'), last_error = NULL WHERE proxy_host_id = ?`)
          .run(status, config.proxyHostId);
      } catch (err) {
        getDb()
          .prepare(`UPDATE proxy_failovers SET last_status = 'error', last_checked_at = datetime('now'), last_error = ? WHERE proxy_host_id = ?`)
          .run(err instanceof Error ? err.message : "Erreur inconnue.", config.proxyHostId);
      }
    })
  );
}
