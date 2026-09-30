import { getDb, getSetting, setSetting } from "./db";
import { getProxyHost, updateProxyHost, listProxyHosts, type ProxyHost } from "./npm";
import { notifyAll, hasAnyNotificationChannel } from "./notifications/notify";

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
 * Up to two fallback tiers, tried in order, both optional and independent of each other:
 *  1. a real backup server (proxy_pass) — typically the HA replication's target host, wired in
 *     automatically by lib/ha/failoverWiring.ts, but can also be set by hand or by the "appliquer
 *     à tous" bulk default (see applyDefaultFailoverToAll below).
 *  2. a static maintenance page, inlined into the generated nginx snippet via `return 200 '...'`
 *     rather than a file on disk — deliberate, since NPM is only ever reached through its own REST
 *     API here (lib/npm.ts), with no assumption that this panel has SSH/filesystem access to
 *     whatever host actually runs it.
 * When both are set, nginx tries the primary, then the backup server, then the page — each tier
 * only kicks in once the one before it has already failed. A host with only one tier configured
 * gets the simpler single-tier snippet (no nested location needed).
 *
 * The health-check scheduler (lib/npmFailoverScheduler.ts) is therefore *not* what performs the
 * failover — it only probes each configured tier periodically to keep a status ("primaire actif" /
 * "basculé sur le secours" / "basculé sur la page de maintenance" / "erreur") for display,
 * independent of nginx's own real-time behavior.
 */

const MARKER_START = "# BEGIN homelab-panel-failover — generated, do not edit inside these markers";
const MARKER_END = "# END homelab-panel-failover";
const BACKUP_LOCATION = "@homelab_failover_backup";
const PAGE_LOCATION = "@homelab_failover_page";

export type FailoverServer = { scheme: "http" | "https"; host: string; port: number; path?: string };
export type FailoverSource = "manual" | "ha" | "default";

function normalizePath(path: string | undefined): string {
  const trimmed = (path ?? "/").trim() || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Escapes HTML for safe embedding inside a single-quoted nginx string literal: backslashes and
 * single quotes need escaping so they don't break out of the quote, and a literal `$` needs
 * escaping too, or nginx tries to interpolate it as the start of a variable reference. NPM
 * validates the resulting config server-side before applying it (same safety net as any other
 * update through this panel) — a mistake here surfaces as a rejected save, not a broken live site. */
function escapeForNginxString(html: string): string {
  return html.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
}

function pageLocationBlock(name: string, html: string): string {
  return [`location ${name} {`, "  internal;", "  default_type text/html;", `  return 200 '${escapeForNginxString(html)}';`, "}"].join(
    "\n"
  );
}

function serverLocationBlock(name: string, server: FailoverServer, nextErrorLocation: string | null): string {
  const lines = [`location ${name} {`, "  internal;"];
  if (nextErrorLocation) {
    lines.push("  proxy_intercept_errors on;", `  error_page 502 503 504 = ${nextErrorLocation};`);
  }
  lines.push(
    `  proxy_pass ${server.scheme}://${server.host}:${server.port}${normalizePath(server.path)};`,
    "  proxy_set_header Host $host;",
    "  proxy_set_header X-Real-IP $remote_addr;",
    "  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "  proxy_set_header X-Forwarded-Proto $scheme;",
    "}"
  );
  return lines.join("\n");
}

/** Builds the whole marker-delimited snippet for whichever tiers are actually configured — null
 * when neither is, meaning "no failover block at all" for this host. */
function buildSnippet(server: FailoverServer | null, html: string | null): string | null {
  if (!server && !html) return null;

  const blocks: string[] = ["proxy_intercept_errors on;", `error_page 502 503 504 = ${BACKUP_LOCATION};`];
  if (server && html) {
    blocks.push(serverLocationBlock(BACKUP_LOCATION, server, PAGE_LOCATION));
    blocks.push(pageLocationBlock(PAGE_LOCATION, html));
  } else if (server) {
    blocks.push(serverLocationBlock(BACKUP_LOCATION, server, null));
  } else if (html) {
    blocks.push(pageLocationBlock(BACKUP_LOCATION, html));
  }

  return [MARKER_START, ...blocks, MARKER_END].join("\n");
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
  /** Kept for rough backward compatibility with the single-host edit form: reflects whichever
   * tier is considered "primary" for display purposes when only one is set. When both a server
   * and a page are configured, this is "server" (the page is the one-past-that fallback). */
  mode: "server" | "page";
  hasServer: boolean;
  backupScheme: "http" | "https";
  backupHost: string;
  backupPort: number;
  backupPath: string;
  backupSource: FailoverSource;
  hasPage: boolean;
  maintenanceHtml: string | null;
  enabled: boolean;
  lastStatus: "unknown" | "primary" | "failover" | "failover_page" | "error";
  lastCheckedAt: string | null;
  lastError: string | null;
  needsResyncReminder: boolean;
  lastFailbackAt: string | null;
};

type FailoverRow = {
  proxy_host_id: number;
  mode: "server" | "page";
  backup_scheme: "http" | "https";
  backup_host: string;
  backup_port: number;
  backup_path: string;
  backup_source: FailoverSource;
  maintenance_html: string | null;
  enabled: number;
  last_status: FailoverConfig["lastStatus"];
  last_checked_at: string | null;
  last_error: string | null;
  needs_resync_reminder: number;
  last_failback_at: string | null;
};

function rowToConfig(row: FailoverRow): FailoverConfig {
  const hasServer = !!row.backup_host;
  const hasPage = row.maintenance_html !== null;
  return {
    proxyHostId: row.proxy_host_id,
    mode: hasServer ? "server" : "page",
    hasServer,
    backupScheme: row.backup_scheme,
    backupHost: row.backup_host,
    backupPort: row.backup_port,
    backupPath: row.backup_path,
    backupSource: row.backup_source,
    hasPage,
    maintenanceHtml: row.maintenance_html,
    enabled: row.enabled === 1,
    lastStatus: row.last_status,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    needsResyncReminder: row.needs_resync_reminder === 1,
    lastFailbackAt: row.last_failback_at,
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

export type ApplyFailoverInput = {
  /** undefined = leave this host's current server tier untouched; null = clear it; an object =
   * replace it. `source` only takes effect when `server` is an object or null (a change actually
   * happened) — an html-only update never reclassifies who "owns" the server tier. */
  server?: FailoverServer | null;
  /** undefined = leave the current page tier untouched; null = clear it; a string = replace it. */
  html?: string | null;
  source: FailoverSource;
};

/** Applies (a subset of) a host's failover tiers and regenerates its nginx snippet from whatever
 * the merged result is. Both callers that only ever touch one tier at a time — the per-host manual
 * form (full replace of both, mode-exclusive as before) and applyDefaultFailoverToAll (server tier
 * left alone for HA-owned hosts, html tier always updated) — go through this same function. */
export async function applyFailover(proxyHostId: number, input: ApplyFailoverInput): Promise<void> {
  const current = getFailoverConfig(proxyHostId);
  const server =
    input.server === undefined
      ? current?.hasServer
        ? { scheme: current.backupScheme, host: current.backupHost, port: current.backupPort, path: current.backupPath }
        : null
      : input.server;
  const html = input.html === undefined ? (current?.hasPage ? current.maintenanceHtml : null) : input.html;
  const source = input.server !== undefined ? input.source : (current?.backupSource ?? "manual");

  const host = await getProxyHost(proxyHostId);
  const snippet = buildSnippet(server, html);
  await pushAdvancedConfig(host, snippet);

  if (!server && !html) {
    getDb().prepare(`DELETE FROM proxy_failovers WHERE proxy_host_id = ?`).run(proxyHostId);
    return;
  }

  getDb()
    .prepare(
      `INSERT INTO proxy_failovers (proxy_host_id, mode, backup_scheme, backup_host, backup_port, backup_path, backup_source, maintenance_html, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(proxy_host_id) DO UPDATE SET
         mode = excluded.mode,
         backup_scheme = excluded.backup_scheme,
         backup_host = excluded.backup_host,
         backup_port = excluded.backup_port,
         backup_path = excluded.backup_path,
         backup_source = excluded.backup_source,
         maintenance_html = excluded.maintenance_html,
         enabled = 1`
    )
    .run(
      proxyHostId,
      server ? "server" : "page",
      server?.scheme ?? "http",
      server?.host ?? "",
      server?.port ?? 0,
      server ? normalizePath(server.path) : "/",
      source,
      html
    );
}

export async function removeFailover(proxyHostId: number): Promise<void> {
  const host = await getProxyHost(proxyHostId);
  await pushAdvancedConfig(host, null);
  getDb().prepare(`DELETE FROM proxy_failovers WHERE proxy_host_id = ?`).run(proxyHostId);
}

const DEFAULTS_SETTING_KEY = "npm_failover_defaults";

export type FailoverDefaults = { server: FailoverServer | null; html: string | null };

export function getFailoverDefaults(): FailoverDefaults {
  const raw = getSetting(DEFAULTS_SETTING_KEY);
  return raw ? JSON.parse(raw) : { server: null, html: null };
}

/**
 * The "appliquer à tous" action: saves the given server/page defaults for next time, then applies
 * them to every NPM proxy host — except a host's *server* tier is left alone when it's already
 * owned by an HA replication (backup_source === 'ha'), which always takes precedence over the
 * generic default (an HA-linked host already has a real, site-specific backup wired in by
 * lib/ha/failoverWiring.ts; the whole point of that is more specific than "the same generic backup
 * every other site gets"). The page tier has no such per-site ownership, so it's always set to the
 * new default on every host, HA-linked or not — that's the "last resort" the user is configuring.
 * A host without a proxy_failovers row yet (first time failover is ever configured for it) is
 * created fresh here as 'default'-sourced.
 */
export async function applyDefaultFailoverToAll(
  defaults: FailoverDefaults
): Promise<{ applied: number; haPreserved: string[]; failed: { host: string; error: string }[] }> {
  setSetting(DEFAULTS_SETTING_KEY, JSON.stringify(defaults));

  const hosts = await listProxyHosts();
  let applied = 0;
  const haPreserved: string[] = [];
  const failed: { host: string; error: string }[] = [];

  for (const host of hosts) {
    try {
      const current = getFailoverConfig(host.id);
      const keepServer = current?.hasServer && current.backupSource === "ha";
      if (keepServer) haPreserved.push(host.domainNames[0] ?? `#${host.id}`);
      await applyFailover(host.id, {
        server: keepServer ? undefined : defaults.server,
        html: defaults.html,
        source: "default",
      });
      applied++;
    } catch (err) {
      failed.push({ host: host.domainNames[0] ?? `#${host.id}`, error: err instanceof Error ? err.message : "Erreur inconnue." });
    }
  }

  return { applied, haPreserved, failed };
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function probe(scheme: string, host: string, port: number, path = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      // Any HTTP response at all (even a 4xx/5xx from the app itself) means the server is up and
      // answering — only a connection failure/timeout counts as "down" for failover purposes,
      // since that's the same condition nginx's own error_page fallback reacts to.
      await fetch(`${scheme}://${host}:${port}${path}`, { signal: controller.signal, redirect: "manual" });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Best-effort visibility only — see the module comment for why this never touches NPM's config
 * itself. One host's check failing (unreachable target, DNS hiccup) never blocks the others.
 * 'failover_page' means the primary (and the backup server, if one is configured) are both down —
 * there's no backup *server* to probe in that case, the static page is always "available", so
 * reaching this tier is certain rather than probed. */
export async function checkAllFailovers(): Promise<void> {
  const configs = listFailoverConfigs().filter((c) => c.enabled);
  await Promise.all(
    configs.map(async (config) => {
      try {
        const host = await getProxyHost(config.proxyHostId);
        const primaryUp = await probe(host.forwardScheme, host.forwardHost, host.forwardPort);
        let status: FailoverConfig["lastStatus"];
        if (primaryUp) {
          status = "primary";
        } else if (config.hasServer && (await probe(config.backupScheme, config.backupHost, config.backupPort, config.backupPath))) {
          status = "failover";
        } else if (config.hasPage) {
          status = "failover_page";
        } else if (config.hasServer) {
          status = "error";
        } else {
          status = "error";
        }
        getDb()
          .prepare(`UPDATE proxy_failovers SET last_status = ?, last_checked_at = datetime('now'), last_error = NULL WHERE proxy_host_id = ?`)
          .run(status, config.proxyHostId);

        // The primary just came back after actually being replaced by the backup *server* (not
        // the static page, which never receives real writes, and not merely "erreur", which never
        // sent traffic anywhere else) — real writes may have landed on the backup in the meantime,
        // and nothing resyncs that back to the primary automatically. Flag it so the reminder
        // survives past this one check, instead of a notification that's easy to miss.
        if (config.lastStatus === "failover" && status === "primary") {
          getDb()
            .prepare(
              `UPDATE proxy_failovers SET needs_resync_reminder = 1, last_failback_at = datetime('now') WHERE proxy_host_id = ?`
            )
            .run(config.proxyHostId);
          if (hasAnyNotificationChannel()) {
            const domain = host.domainNames[0] ?? `hôte NPM #${host.id}`;
            notifyAll(
              `↩ Retour au serveur principal : ${domain}`,
              `Le serveur principal de "${domain}" répond de nouveau et reprend la main sur le serveur de secours.\n\nDes données ont pu changer sur le serveur de secours pendant la bascule — pense à vérifier s'il faut resynchroniser depuis lui avant de considérer le principal à jour.`
            ).catch(() => {});
          }
        }
      } catch (err) {
        getDb()
          .prepare(`UPDATE proxy_failovers SET last_status = 'error', last_checked_at = datetime('now'), last_error = ? WHERE proxy_host_id = ?`)
          .run(err instanceof Error ? err.message : "Erreur inconnue.", config.proxyHostId);
      }
    })
  );
}

/** Clears the reminder — either because the linked HA replication's reverse sync just succeeded
 * (see lib/ha's runReverseSync), or because the user manually checked and confirmed no resync was
 * actually needed. A no-op for a proxy host with no reminder set. */
export function clearResyncReminder(proxyHostId: number): void {
  getDb().prepare(`UPDATE proxy_failovers SET needs_resync_reminder = 0 WHERE proxy_host_id = ?`).run(proxyHostId);
}
