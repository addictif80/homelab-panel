import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { getCurrentDemoId } from "./demo/context";
import { getDemoDb } from "./demo/store";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(/* turbopackIgnore: true */ DATA_DIR)) {
  fs.mkdirSync(/* turbopackIgnore: true */ DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "panel.db");

declare global {
  // eslint-disable-next-line no-var
  var __homelabDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  // A request running inside a /demo sandbox (see lib/demo/context.ts, set from the raw incoming
  // request in server.ts before Next's own routing runs) is redirected to its own isolated
  // in-memory database instead of the real one — every existing DB-backed page/route "just works"
  // against fake data without needing a demo-aware branch of its own. lib/demo/ ships in every
  // export (unlike seed.ts below) — it holds no real secrets, only fictitious seed data — and is
  // otherwise inert without SELLER_MODE (getCurrentDemoId() can never be non-null, since nothing
  // can mint that cookie without it: see app/demo/route.ts).
  const demoId = getCurrentDemoId();
  if (demoId) {
    const demoDb = getDemoDb(demoId);
    // Never silently fall through to the real database just because a demo cookie didn't
    // resolve (expired, or evicted under load) — that would mean a stale demo visitor's request
    // starts reading/writing real production data instead. Surface a clear error; the client
    // re-visits /demo for a fresh sandbox.
    if (!demoDb) throw new Error("Session démo expirée — retourne sur /demo pour en obtenir une nouvelle.");
    return demoDb;
  }

  if (!global.__homelabDb) {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    global.__homelabDb = db;
    // Seeds the seller's own real inventory for local dev/demo convenience — never on a customer
    // install, which must start with an empty inventory, not the seller's actual server names,
    // LAN IPs and network topology. Not a NEXT_PUBLIC_ var, same reasoning as license.ts's
    // isSellerInstance(): it gates a server-side decision, so it can't be set from a customer's
    // own build environment. seed.ts itself is also excluded from the exported client zip (see
    // exportBuild.ts) — this check is what makes that exclusion safe to do without crashing a
    // fresh customer install on the require() below.
    if (process.env.SELLER_MODE === "true") {
      // Lazy import avoids a circular dependency (seed.ts calls back into getDb()).
      require("./seed").seedIfEmpty();
    }
  }
  return global.__homelabDb;
}

export function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret_encrypted TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trusted_devices_username ON trusted_devices(username);

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      username TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('physical','vm','lxc','vps','nas','router')),
      role TEXT,
      os TEXT,
      cluster TEXT,
      parent_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      lan_ip TEXT,
      tailscale_ip TEXT,
      public_ip TEXT,
      ssh_port INTEGER DEFAULT 22,
      ssh_user TEXT,
      docker_enabled INTEGER NOT NULL DEFAULT 0,
      update_method TEXT,
      needs_sudo INTEGER NOT NULL DEFAULT 1,
      proxmox_node TEXT,
      router_provider TEXT,
      notes TEXT,
      -- Set by hand, never inferred from IP/subnet (too easy to get wrong on a home network that
      -- routes several sites over the same private range) — feeds the 3-2-1 backup rule check
      -- (lib/backup/rule321.ts), which needs a real answer to "is this destination actually
      -- somewhere else" rather than a guess.
      offsite INTEGER NOT NULL DEFAULT 0,
      -- Estimated power draw at idle / full load, in watts — set by hand (see the ALTER TABLE
      -- below for why this is never guessed), feeds the electricity cost estimate.
      watts_idle INTEGER,
      watts_max INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ssh_key','ssh_password','sudo_password','api_token')),
      label TEXT,
      encrypted_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A separate table rather than another value in credentials.kind — that column's CHECK
    -- constraint can't be widened on an existing SQLite install without recreating the table, and
    -- RDP's shape (one login + a port, not a rotating list of secrets) doesn't fit the
    -- multiple-credentials-per-host model the credentials table was built for anyway. One row per
    -- host is also what lets its mere presence answer "does this host have RDP configured"
    -- without a separate enabled flag that could drift out of sync.
    CREATE TABLE IF NOT EXISTS rdp_credentials (
      host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      port INTEGER NOT NULL DEFAULT 3389,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS network_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_a_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      host_b_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL DEFAULT 'network'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS update_jobs (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('dry-run','apply')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      exit_code INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_update_jobs_host ON update_jobs(host_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS notified_findings (
      finding_key TEXT PRIMARY KEY,
      last_notified_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS copy_jobs (
      id TEXT PRIMARY KEY,
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      dest_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      dest_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_ssh_key (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key TEXT NOT NULL,
      private_key_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backup_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('paths','docker','database','proxmox_vm')),
      source_config TEXT NOT NULL,
      dest_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      dest_path TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT 'manual' CHECK (schedule IN ('manual','hourly','daily','weekly')),
      retention_count INTEGER NOT NULL DEFAULT 7,
      enabled INTEGER NOT NULL DEFAULT 1,
      at_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES backup_plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      snapshot_path TEXT,
      paths_json TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backup_runs_plan ON backup_runs(plan_id, started_at DESC);

    -- One job per "renaissance" (a single service restored + relaunched elsewhere from its
    -- latest backup, see lib/backup/resurrect.ts) or "clonage" (the same, looped over every
    -- backup plan of one host, onto one new machine). plan_id is NULL for a clone job since it
    -- spans several plans — its own log carries the per-plan breakdown instead.
    -- One row per restoration drill (see lib/backup/drill.ts): restores a plan's latest snapshot
    -- into a disposable scratch directory on its own source host, counts the files that actually
    -- came back, and deletes the scratch copy — proof the backup is real and restorable, not just
    -- that the last run "succeeded" (which only proves the copy step worked, not that it's usable).
    CREATE TABLE IF NOT EXISTS restore_drills (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES backup_plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      files_expected INTEGER,
      files_restored INTEGER,
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_restore_drills_plan ON restore_drills(plan_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS service_resurrections (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('single','clone')),
      plan_id TEXT REFERENCES backup_plans(id) ON DELETE SET NULL,
      target_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','activated')),
      trial_started_at TEXT NOT NULL DEFAULT (datetime('now')),
      activation_key TEXT,
      activated_at TEXT,
      certificate_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT UNIQUE NOT NULL,
      customer_email TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS download_tokens (
      token TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS license_signing_key (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key_pem TEXT NOT NULL,
      private_key_pem_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS license_keys (
      key TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT,
      used_by_info TEXT
    );

    CREATE TABLE IF NOT EXISTS security_ignored (
      finding_key TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL,
      finding_id TEXT NOT NULL,
      ignored_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per calendar day (upserted, not appended) — a "score de risque à 30 jours" is a
    -- trend line, and a trend line needs at most one point per day regardless of how many times
    -- the scheduler or a manual scan recomputes it that day.
    CREATE TABLE IF NOT EXISTS risk_score_history (
      date TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tracks IPs blocked from the Security Center as a single infra-wide registry: an IP is
    -- blocked/unblocked everywhere at once (see lib/firewall.ts), so there's no per-host state to
    -- model here, just "is this IP currently on the list".
    CREATE TABLE IF NOT EXISTS blocked_ips (
      ip TEXT PRIMARY KEY,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_ids_json TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'apply' CHECK (mode IN ('dry-run','apply')),
      allow_auto_reboot INTEGER NOT NULL DEFAULT 0,
      delay_seconds INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS maintenance_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      current_index INTEGER NOT NULL DEFAULT 0,
      job_ids_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_maintenance_runs_plan ON maintenance_runs(plan_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      changelog TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS self_update_jobs (
      id TEXT PRIMARY KEY,
      from_version TEXT NOT NULL,
      to_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The "boîte noire" for Vue vivante: a rolling recording of every host's reachability pulse,
    -- pruned to a fixed retention window (see lib/pulseRecorder.ts) rather than kept forever —
    -- this is a scrub-back-through-recent-history feature, not a long-term metrics store.
    CREATE TABLE IF NOT EXISTS pulse_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      reachable INTEGER NOT NULL,
      latency_ms INTEGER,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pulse_history_time ON pulse_history(recorded_at);

    -- Sampled every 15 min (see lib/power/recorder.ts), not on every dashboard load like the live
    -- monitoring stats — CPU load is read over SSH, and this table exists purely to average it
    -- over a billing period, which doesn't need second-by-second resolution. Pruned to
    -- POWER_RETENTION_DAYS, same rolling-window spirit as pulse_history.
    CREATE TABLE IF NOT EXISTS power_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      cpu_percent REAL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_power_samples_time ON power_samples(recorded_at);

    -- One row per WAN outage the panel itself observed (see lib/isp/outageRecorder.ts) — probing
    -- well-known external hosts every minute, never the ISP's own status page (which is often the
    -- first thing to go down, or to lie). ended_at stays NULL while the outage is ongoing; a row
    -- with ended_at set is the raw material for the auto-generated proof-of-outage report.
    CREATE TABLE IF NOT EXISTS isp_outages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    -- One row per (source, target) pair tested in a throughput run (see lib/throughput.ts) —
    -- manual-trigger only, like the security scan: testing every pair on a schedule would mean
    -- constant multi-hundred-MB transfers between every machine in the fleet for no reason.
    CREATE TABLE IF NOT EXISTS throughput_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      target_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      mbps REAL,
      error TEXT,
      tested_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_throughput_tests_run ON throughput_tests(run_id);

    -- A buyer's support request. access_token is the only credential needed to view/reply to a
    -- ticket from the public store site — no account required, same spirit as download_tokens.
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('customer','seller')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at);

    -- Background job tracking shared by Docker container migration and Proxmox VM/CT migration —
    -- both can run for minutes (image/volume transfer, vzdump+restore), so the API starts the job
    -- and returns a job id immediately rather than holding the HTTP request open.
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('docker','vm')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    -- One-click Docker app templates — seeded once from a curated built-in list (see
    -- lib/appTemplates.ts) but fully editable/deletable/addable from the panel afterwards, unlike
    -- the old hardcoded-in-source-only list.
    CREATE TABLE IF NOT EXISTS app_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL,
      ports_json TEXT NOT NULL DEFAULT '[]',
      volumes_json TEXT NOT NULL DEFAULT '[]',
      env_json TEXT NOT NULL DEFAULT '[]',
      restart_policy TEXT NOT NULL DEFAULT 'unless-stopped',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Promo codes: mirrors a Stripe Coupon + PromotionCode pair created alongside each row, so
    -- Stripe remains the actual source of truth for redemption counting and discount application
    -- at Checkout (this table exists for the seller admin UI and quick local validation, not as a
    -- second enforcement engine).
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','amount')),
      discount_value INTEGER NOT NULL,
      applicable_plans TEXT NOT NULL DEFAULT '["lifetime","monthly","annual"]',
      max_redemptions INTEGER,
      valid_from TEXT,
      valid_until TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      stripe_coupon_id TEXT,
      stripe_promotion_code_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Paid "I lost my lifetime key" flow: kept separate from the sales table (which only ever
    -- describes a licensing purchase tied to a Stripe Price/plan) so this ad-hoc, price_data-based
    -- charge doesn't have to fit the PlanKey union.
    -- Seller-side anti-reset registry for the free trial: keyed by a hashed machine fingerprint
    -- (see lib/machineFingerprint.ts) rather than anything stored in the client's own database,
    -- so wiping panel.db to relaunch a fresh trial doesn't also erase the evidence of the first one.
    CREATE TABLE IF NOT EXISTS trial_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Portainer-style "Stacks": arbitrary docker-compose.yml content the user pastes in, deployed
    -- to a chosen host in one click via docker compose, rather than being limited to the
    -- predefined one-click app templates (see lib/appTemplates.ts).
    CREATE TABLE IF NOT EXISTS docker_stacks (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      compose_content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS key_recovery_orders (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bookmark-style dashboard of hosted services (name + URL + favicon), optionally surfaced on
    -- the unauthenticated public board (see /board and /api/public/services). The favicon is
    -- fetched and cached server-side as a data URL rather than hotlinked, since a visitor to the
    -- public board has no reason to be able to reach an internal-only service's own origin to load
    -- its icon. click_count is shared between the internal page and the public board — both call
    -- the same increment endpoint, so it reflects total engagement either way.
    CREATE TABLE IF NOT EXISTS service_links (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      favicon_data_url TEXT,
      -- Best-effort (see lib/screenshot.ts): only populated when a Chromium binary is found on
      -- this host, cached as a data URL for the same reason the favicon is — a public board
      -- visitor has no way to reach an internal-only service to render it themselves.
      screenshot_data_url TEXT,
      show_public INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      -- "Annuaire public" opt-in: submitted to the seller's central directory (see
      -- lib/directorySubmission.ts, a no-op with no licenseServerUrl configured — i.e. on the
      -- seller's own instance or a raw dev checkout) for admin approval before it can appear on
      -- the public landing page. directory_status mirrors what the seller's directory_submissions
      -- table last reported for directory_submission_id.
      directory_opt_in INTEGER NOT NULL DEFAULT 0,
      directory_status TEXT NOT NULL DEFAULT 'none' CHECK (directory_status IN ('none','pending','approved','rejected')),
      directory_submission_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Seller-side only (empty on every customer install, which never gets the seller admin UI or
    -- routes to write to it — see exportBuild.ts's exclusion list): pending/approved/rejected
    -- submissions to the public directory shown on the landing page, one per (license_key,
    -- instance_id, service_url) so re-submitting an edited link updates rather than duplicates.
    CREATE TABLE IF NOT EXISTS directory_submissions (
      id TEXT PRIMARY KEY,
      license_key TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      service_name TEXT NOT NULL,
      service_url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      favicon_data_url TEXT,
      screenshot_data_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      UNIQUE (license_key, instance_id, service_url)
    );

    -- Where to read incoming-mail activity from, for the spam log (see lib/mail/mailIngest.ts).
    -- Three kinds: a log file on an SSH-reachable host (a native Postfix/Exim install), a Docker
    -- container's own log output (a dockerized mail stack like Mailcow), or rspamd's own HTTP
    -- controller API (queried via a "docker exec <container> curl ... /history" call). The first two are
    -- deliberately not coupled to any one mail server product — the parser only looks for generic
    -- Postfix-style syslog lines and a generic rspamd-style summary line — but neither can ever
    -- carry the message subject: Postfix's logs never see message content (envelope/connection
    -- info only), and rspamd's default per-message log line omits the subject by design (privacy).
    -- The subject only exists in rspamd's own history, and only when its optional history_redis
    -- module is active (on by default in Mailcow) — hence the third source type, which is the only
    -- one that can ever populate mail_events.subject.
    -- cursor is opaque to callers: a byte offset for a file source, or an ISO timestamp (the
    -- "--since" cutoff for the next docker logs call) for a docker source; unused for rspamd_api
    -- (its /history response is small enough to re-fetch whole each poll, deduped like everything
    -- else via mail_events.dedupe_key).
    CREATE TABLE IF NOT EXISTS mail_log_sources (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('file','docker','rspamd_api')),
      source_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cursor TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      rspamd_port INTEGER,
      rspamd_password_encrypted TEXT
    );

    -- One row per received message the parser could identify. dedupe_key (a hash of the source
    -- id + the raw log line(s) it was built from) makes re-ingesting the same lines after a
    -- restart or a cursor rewind a no-op instead of duplicating rows.
    CREATE TABLE IF NOT EXISTS mail_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL REFERENCES mail_log_sources(id) ON DELETE CASCADE,
      dedupe_key TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      sender_email TEXT,
      subject TEXT,
      recipient TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mail_events_received ON mail_events(received_at DESC);

    -- Sender-address blocklist, parallel to blocked_ips (lib/firewall.ts): a single infra-wide
    -- registry rather than per-host state, enforced via a Postfix sender_access map on every
    -- SSH-reachable host that has Postfix (see lib/mail/senderBlock.ts) — the same "block
    -- everywhere, best-effort per host" shape as blockIpEverywhere.
    CREATE TABLE IF NOT EXISTS blocked_senders (
      email TEXT PRIMARY KEY,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A database server the embedded manager (lib/dbManager/*) can reach — every operation runs
    -- as a CLI command (mysql/psql, optionally through docker exec when container_id is set)
    -- over the same SSH connection already used for every other host feature, rather than opening
    -- a direct TCP connection to the database port. password_encrypted is vault-encrypted at rest,
    -- same convention as backup_plans' database source config.
    CREATE TABLE IF NOT EXISTS db_connections (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      engine TEXT NOT NULL CHECK (engine IN ('mysql','postgres')),
      container_id TEXT,
      db_host TEXT NOT NULL DEFAULT '127.0.0.1',
      db_port INTEGER NOT NULL,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Failover pairing for an NPM proxy host (see lib/npmFailover.ts). proxy_host_id is NPM's own
    -- numeric id, not a local one — NPM itself remains the only source of truth for the actual
    -- routing config (a marker-delimited nginx snippet in that host's own "Advanced" field); this
    -- table only remembers the backup target and the last health-check result for the UI, and
    -- would naturally go stale/orphaned if the proxy host were deleted directly in NPM (harmless:
    -- the next check just starts failing to fetch that host and the row can be removed by hand).
    CREATE TABLE IF NOT EXISTS proxy_failovers (
      proxy_host_id INTEGER PRIMARY KEY,
      backup_scheme TEXT NOT NULL,
      backup_host TEXT NOT NULL,
      backup_port INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT 'unknown' CHECK (last_status IN ('unknown','primary','failover','error')),
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Private scratchpad on Vue d'ensemble — one per user (keyed by username, same identity the
    -- session cookie carries), never shared between accounts on the same instance.
    CREATE TABLE IF NOT EXISTS user_notes (
      username TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Vue d'ensemble widget layout — one per user (same key as user_notes), never shared. layout
    -- is a JSON array of widget ids in display order; a widget id absent from it is hidden. NULL/no
    -- row means "never customized" — the client falls back to DEFAULT_LAYOUT (dashboardWidgets.ts).
    CREATE TABLE IF NOT EXISTS user_dashboard_layout (
      username TEXT PRIMARY KEY,
      layout TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Accès rapide widget shortcuts — one per user, never shared. items is a JSON array of
    -- {label, href, color}. NULL/no row means "never customized" — the client falls back to
    -- DEFAULT_QUICK_ACCESS_ITEMS (lib/quickAccessCatalog.ts).
    CREATE TABLE IF NOT EXISTS user_quick_access (
      username TEXT PRIMARY KEY,
      items TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Trial clock starts the instant the database is first created — not on some later "first
  // visit", which would let someone stall the countdown by just not opening the app.
  db.exec(`INSERT OR IGNORE INTO license (id, status) VALUES (1, 'trial')`);

  seedAppTemplatesIfEmpty(db);

  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!userColumns.some((c) => c.name === "role")) {
    // Existing installs only ever had one account — the person who set the panel up — so it
    // keeps full access on upgrade rather than being silently downgraded to viewer.
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  }
  if (!userColumns.some((c) => c.name === "email")) {
    // Optional — only needed to unlock the "receive the 2FA code by email" alternative to the
    // authenticator app (see lib/emailTwoFactor.ts). Nobody is forced to set one.
    db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
  }
  if (!userColumns.some((c) => c.name === "locked")) {
    // Set on every account except the trusted contact's own the moment an emergency access
    // request activates (see lib/emergencyAccess.ts) — checked at login. Only an admin account
    // (the newly-activated trusted contact, in practice) can clear it again, from Comptes.
    db.exec(`ALTER TABLE users ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!userColumns.some((c) => c.name === "is_trusted_contact")) {
    // Marks the account created by a completed emergency access request — lets the UI show it a
    // simplified "what do I do now" guide instead of the regular panel chrome assuming familiarity.
    db.exec(`ALTER TABLE users ADD COLUMN is_trusted_contact INTEGER NOT NULL DEFAULT 0`);
  }

  const mailEventColumns = db.prepare(`PRAGMA table_info(mail_events)`).all() as { name: string }[];
  if (!mailEventColumns.some((c) => c.name === "recipient")) {
    // Same source restriction as subject (see mail_log_sources' comment above): only rspamd's own
    // log line (rcpts:/mime_rcpts:) or its /history API ever carries it — Postfix's logs never do.
    db.exec(`ALTER TABLE mail_events ADD COLUMN recipient TEXT`);
  }

  const mailLogSourceColumns = db.prepare(`PRAGMA table_info(mail_log_sources)`).all() as { name: string }[];
  if (!mailLogSourceColumns.some((c) => c.name === "rspamd_port")) {
    db.exec(`ALTER TABLE mail_log_sources ADD COLUMN rspamd_port INTEGER`);
  }
  if (!mailLogSourceColumns.some((c) => c.name === "rspamd_password_encrypted")) {
    db.exec(`ALTER TABLE mail_log_sources ADD COLUMN rspamd_password_encrypted TEXT`);
  }
  // The CHECK(source_type IN (...)) above only takes effect on a freshly created table — an
  // existing install's table object on disk still enforces the old, narrower list and would
  // reject 'rspamd_api' rows outright. SQLite has no ALTER TABLE for a CHECK constraint, so
  // widening it means the classic create-copy-drop-rename dance; guarded on sqlite_master's own
  // stored SQL for the table so it only ever runs once, and a fresh install (already created with
  // 'rspamd_api' above) never takes this path at all.
  const mailLogSourceTableSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mail_log_sources'`).get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (mailLogSourceTableSql && !mailLogSourceTableSql.includes("rspamd_api")) {
    // mail_events.source_id REFERENCES mail_log_sources(id) ON DELETE CASCADE — with FK
    // enforcement on, DROP TABLE performs an implicit "DELETE FROM" first to fire that cascade,
    // which would wipe every stored mail_events row as a side effect of this migration. Foreign
    // keys have to come off for this recreate and back on right after (both required outside any
    // transaction — SQLite rejects toggling the pragma mid-transaction).
    db.pragma("foreign_keys = OFF");
    db.exec(`
      BEGIN;
      CREATE TABLE mail_log_sources_new (
        id TEXT PRIMARY KEY,
        host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK (source_type IN ('file','docker','rspamd_api')),
        source_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        cursor TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        rspamd_port INTEGER,
        rspamd_password_encrypted TEXT
      );
      INSERT INTO mail_log_sources_new SELECT * FROM mail_log_sources;
      DROP TABLE mail_log_sources;
      ALTER TABLE mail_log_sources_new RENAME TO mail_log_sources;
      COMMIT;
    `);
    db.pragma("foreign_keys = ON");
  }

  // One-time codes for the email-delivered 2FA alternative — deliberately its own table rather
  // than reusing trusted_devices or login_attempts, since a code here is short-lived (minutes,
  // not days) and single-use, and needs its own hash + consumed flag. Rows outlive their expiry
  // only until the next code is requested for that username (see emailTwoFactor.ts), which
  // deletes any previous one first — nothing here needs a scheduled sweep.
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_login_codes (
      username TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Singleton (id=1) — "in case of death" emergency contact. Identity fields are vault-encrypted
    -- (real PII, no reason to leave it in plaintext at rest); the three answers are hashed like a
    -- password (bcrypt), never stored or shown in the clear, even to the admin who set them —
    -- exactly the security-question model any real identity check needs to survive a stolen
    -- database dump.
    CREATE TABLE IF NOT EXISTS trusted_contact (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      first_name_encrypted TEXT NOT NULL,
      last_name_encrypted TEXT NOT NULL,
      birth_date_encrypted TEXT NOT NULL,
      email_encrypted TEXT NOT NULL,
      question1 TEXT NOT NULL,
      answer1_hash TEXT NOT NULL,
      question2 TEXT NOT NULL,
      answer2_hash TEXT NOT NULL,
      question3 TEXT NOT NULL,
      answer3_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per successfully-verified trigger of the emergency flow — "successfully verified"
    -- meaning identity + all three answers matched, not that access has been granted yet. Real
    -- activation waits until activates_at (see lib/emergencyAccess.ts's scheduler), giving the
    -- 48h cancellation window a place to point its link at.
    CREATE TABLE IF NOT EXISTS emergency_access_requests (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','completed')),
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      activates_at TEXT NOT NULL,
      cancel_token_hash TEXT NOT NULL,
      new_username TEXT,
      completed_at TEXT
    );

    -- Every attempt at the public /emergency-access form, successful or not — the identity+3
    -- security-question check is the one thing standing between "the account owner really died"
    -- and "someone found this URL", so it gets the same brute-force bookkeeping as a real login.
    CREATE TABLE IF NOT EXISTS emergency_access_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One continuous replication link from a source host to a target host, for the high-
    -- availability feature (lib/ha/*.ts): a "folder" replication runs lsyncd (inotify+rsync) on
    -- the source host so a change is pushed within seconds; "mysql"/"postgres" set up that engine's
    -- own native source/replica replication (binlog / streaming WAL) between the two servers'
    -- database processes directly — not something this panel's own scheduler drives once it's
    -- running; "sqlite" has no native replication at all, so it falls back to a frequent consistent
    -- snapshot-and-copy on a timer (see lib/ha/scheduler.ts), the one type this panel's own
    -- scheduler keeps re-triggering forever rather than just monitoring.
    -- source_path/target_path mean different things per kind: a directory for 'folder', a database
    -- name for 'mysql'/'postgres' (same name expected on both ends), a .db file path for 'sqlite'.
    -- db_user/db_password_encrypted are admin-level credentials assumed valid on *both* the source
    -- and target database servers (the common case for a homelab where the same root/admin
    -- credentials are reused everywhere) — used only during setup, to create the dedicated
    -- replication role and take the initial consistent copy. repl_user/repl_password_encrypted are
    -- that dedicated, narrower-scoped role this panel generates and configures on both engines,
    -- which is what actually carries the ongoing replication stream afterwards.
    -- proxy_host_id, when set, is an NPM proxy host id (lib/npm.ts) this replication is the backing
    -- data for — once a setup run finishes successfully, its own target host address (Tailscale
    -- preferred, since B is deliberately not exposed publicly) is pushed straight into that proxy
    -- host's existing failover config (lib/npmFailover.ts) as the backup server, on target_port
    -- (defaulting to the proxy host's own forward port when left null, for the common case where
    -- the same app listens on the same port on both machines) — closing the loop the user asked
    -- for between "replication is healthy" and "failover actually points at it" without a manual
    -- trip through the reverse-proxy page for every replication.
    -- target_owner/target_mode ('folder'/'sqlite' only) are passed straight to rsync's own
    -- --chown/--chmod on every transfer, so files land on B already owned by (and permissioned for)
    -- whatever account runs the web server there — plain rsync -a only preserves the *source's*
    -- numeric uid/gid, which is meaningless once the receiving side runs the transfer as its own
    -- unprivileged, backup-dedicated SSH account rather than root. app_db_user/
    -- app_db_password_encrypted ('mysql' only) are the *application's own* login, separate from
    -- db_user/db_password_encrypted (the setup-time admin credential) and from repl_user (the
    -- internal replication-stream role) — mysqldump/mysql only move the named database's own
    -- schema/data, never the grants table, so without this the app's real login simply wouldn't
    -- exist on B at all. PostgreSQL needs no equivalent column: pg_basebackup clones the *entire*
    -- cluster, roles included (they're global state, not per-database), so the app's existing role
    -- and password are already present on B once the base backup finishes.
    CREATE TABLE IF NOT EXISTS ha_replications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('folder','mysql','postgres','sqlite')),
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      target_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      db_port INTEGER,
      db_user TEXT,
      db_password_encrypted TEXT,
      target_db_user TEXT,
      target_db_password_encrypted TEXT,
      repl_user TEXT,
      repl_password_encrypted TEXT,
      proxy_host_id INTEGER,
      target_port INTEGER,
      target_owner TEXT,
      target_mode TEXT,
      app_db_user TEXT,
      app_db_password_encrypted TEXT,
      target_db_container TEXT,
      source_db_container TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','setting_up','in_sync','lagging','error','stopped')),
      status_detail TEXT,
      last_checked_at TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Generic long-running-action tracker (lib/jobs.ts) — the same insert-running /
    -- append-to-log / finish shape that update_jobs, migration_jobs, copy_jobs, backup_runs and
    -- restore_drills each hand-rolled separately, factored out once so every *new* background
    -- action (IP/sender blocking fan-out, Docker stack redeploy, DB dump/restore...) gets live,
    -- reload-and-device-independent progress for free instead of reinventing this per feature —
    -- the actual gap that made those older ones feel like "nothing happened after I clicked":
    -- their DB rows update live, but the page only ever polls the id it just got back from
    -- starting the action itself, so a reload (or opening the panel from another device) shows a
    -- static "in progress" label at best. kind is deliberately a free string, not a CHECK'd
    -- enum — new job kinds are meant to be added without a migration. host_id is nullable since
    -- some jobs (e.g. IP blocking) fan out across every host at once, not just one.
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_background_jobs_kind ON background_jobs(kind, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status, started_at DESC);
  `);

  const haReplicationColumns = db.prepare(`PRAGMA table_info(ha_replications)`).all() as { name: string }[];
  if (!haReplicationColumns.some((c) => c.name === "proxy_host_id")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN proxy_host_id INTEGER`);
  }
  if (!haReplicationColumns.some((c) => c.name === "target_port")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_port INTEGER`);
  }
  if (!haReplicationColumns.some((c) => c.name === "target_owner")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_owner TEXT`);
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_mode TEXT`);
    db.exec(`ALTER TABLE ha_replications ADD COLUMN app_db_user TEXT`);
    db.exec(`ALTER TABLE ha_replications ADD COLUMN app_db_password_encrypted TEXT`);
  }
  // mysql/postgres: the admin credential used to set up replication was assumed identical on both
  // machines — a real limitation when the two servers were never given the same root password.
  // These columns are optional and null by default: when empty, source credentials are reused for
  // the target too (unchanged behavior for every replication created before this).
  if (!haReplicationColumns.some((c) => c.name === "target_db_user")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_db_user TEXT`);
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_db_password_encrypted TEXT`);
  }

  // 'mysql' only, optional — the target's MariaDB/MySQL isn't always reachable through a native
  // client on the target host's own shell: a target that's a Docker LAMP stack (no mysql/mariadb
  // client installed on the host OS itself, only inside the container) needs every admin SQL
  // command run through `docker exec` into this container instead of a direct network connection.
  // Null keeps the original native-client behavior unchanged.
  if (!haReplicationColumns.some((c) => c.name === "target_db_container")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN target_db_container TEXT`);
  }
  // Same as target_db_container above, but for the source host — either end of a mysql
  // replication can independently be native or Docker-containerized.
  if (!haReplicationColumns.some((c) => c.name === "source_db_container")) {
    db.exec(`ALTER TABLE ha_replications ADD COLUMN source_db_container TEXT`);
  }

  // Optional fixed wall-clock time (e.g. "03:00") for daily/weekly plans — null keeps the original
  // elapsed-time-since-last-run behavior (checked every 15 min, no fixed hour) for every plan
  // created before this and for anyone who doesn't set one.
  const backupPlanColumns = db.prepare(`PRAGMA table_info(backup_plans)`).all() as { name: string }[];
  if (!backupPlanColumns.some((c) => c.name === "at_time")) {
    db.exec(`ALTER TABLE backup_plans ADD COLUMN at_time TEXT`);
  }

  const hostColumns = db.prepare(`PRAGMA table_info(hosts)`).all() as { name: string }[];
  if (!hostColumns.some((c) => c.name === "needs_sudo")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN needs_sudo INTEGER NOT NULL DEFAULT 1`);
  }
  if (!hostColumns.some((c) => c.name === "proxmox_node")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN proxmox_node TEXT`);
  }
  if (!hostColumns.some((c) => c.name === "router_provider")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN router_provider TEXT`);
  }
  if (!hostColumns.some((c) => c.name === "offsite")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN offsite INTEGER NOT NULL DEFAULT 0`);
  }
  // Never inferred from CPU/PSU specs — real-world idle/max draw varies too much by model and PSU
  // efficiency to guess honestly. Left null (host excluded from the cost estimate, not silently
  // assumed to be zero) until the user measures or looks up their own numbers.
  if (!hostColumns.some((c) => c.name === "watts_idle")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN watts_idle INTEGER`);
  }
  if (!hostColumns.some((c) => c.name === "watts_max")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN watts_max INTEGER`);
  }

  const licenseColumns = db.prepare(`PRAGMA table_info(license)`).all() as { name: string }[];
  if (!licenseColumns.some((c) => c.name === "certificate_json")) {
    db.exec(`ALTER TABLE license ADD COLUMN certificate_json TEXT`);
  }
  if (!licenseColumns.some((c) => c.name === "instance_id")) {
    // Random ID generated once locally and embedded (signed) into every certificate this instance
    // requests — lets getVerifiedCertificatePayload() reject a certificate_json copy-pasted in
    // from a different install's database, since the copy's embedded instanceId won't match.
    db.exec(`ALTER TABLE license ADD COLUMN instance_id TEXT`);
  }
  if (!licenseColumns.some((c) => c.name === "last_seen_at")) {
    // Monotonic floor against clock rollback: trial/subscription expiry is computed from
    // max(Date.now(), last_seen_at) instead of raw Date.now(), so winding the system clock back
    // can't un-expire a lapsed trial or subscription.
    db.exec(`ALTER TABLE license ADD COLUMN last_seen_at TEXT`);
  }

  const licenseKeyColumns = db.prepare(`PRAGMA table_info(license_keys)`).all() as { name: string }[];
  if (!licenseKeyColumns.some((c) => c.name === "instance_id")) {
    // Bound to the requesting instance's local instance_id on first successful validate/refresh —
    // /api/seller/license/refresh (a public, unauthenticated endpoint) checks this before
    // re-issuing a signed certificate, so merely knowing another customer's license key text isn't
    // enough to mint a valid certificate for a different installation.
    db.exec(`ALTER TABLE license_keys ADD COLUMN instance_id TEXT`);
  }
  if (!licenseKeyColumns.some((c) => c.name === "revoked_at")) {
    // Self-service revocation ("I think someone else has my key"): the customer's own instance
    // calls /api/seller/license/revoke, which marks the current key revoked here and immediately
    // issues + binds a replacement on the same sale. A revoked key is rejected by /validate and
    // /refresh from then on, so a cloned/leaked copy of this install stops getting a fresh signed
    // certificate the next time its periodic refresh runs (see license.ts's refreshLicenseCertificate,
    // which — unlike before — now also runs for lifetime licenses, not just subscriptions, since
    // that periodic call is what actually detects a revocation for an install that would otherwise
    // never phone home again).
    db.exec(`ALTER TABLE license_keys ADD COLUMN revoked_at TEXT`);
  }

  const serviceLinkColumns = db.prepare(`PRAGMA table_info(service_links)`).all() as { name: string }[];
  if (!serviceLinkColumns.some((c) => c.name === "description")) {
    db.exec(`ALTER TABLE service_links ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!serviceLinkColumns.some((c) => c.name === "screenshot_data_url")) {
    // Best-effort (see lib/screenshot.ts) — only populated when a Chromium binary is found on
    // this host, cached as a data URL for the same reason the favicon is.
    db.exec(`ALTER TABLE service_links ADD COLUMN screenshot_data_url TEXT`);
  }
  if (!serviceLinkColumns.some((c) => c.name === "directory_opt_in")) {
    // Added to CREATE TABLE alongside the "annuaire public" feature but missed here at the time —
    // any service_links table created before that (including this app's own dev DB) never got
    // these columns, so opting into the directory crashed with "no such column: directory_opt_in".
    db.exec(`ALTER TABLE service_links ADD COLUMN directory_opt_in INTEGER NOT NULL DEFAULT 0`);
    db.exec(
      `ALTER TABLE service_links ADD COLUMN directory_status TEXT NOT NULL DEFAULT 'none' CHECK (directory_status IN ('none','pending','approved','rejected'))`
    );
    db.exec(`ALTER TABLE service_links ADD COLUMN directory_submission_id TEXT`);
  }

  const directorySubmissionColumns = db.prepare(`PRAGMA table_info(directory_submissions)`).all() as {
    name: string;
  }[];
  if (!directorySubmissionColumns.some((c) => c.name === "description")) {
    db.exec(`ALTER TABLE directory_submissions ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!directorySubmissionColumns.some((c) => c.name === "screenshot_data_url")) {
    db.exec(`ALTER TABLE directory_submissions ADD COLUMN screenshot_data_url TEXT`);
  }

  const salesColumns = db.prepare(`PRAGMA table_info(sales)`).all() as { name: string }[];
  if (!salesColumns.some((c) => c.name === "product_type")) {
    // Existing rows predate subscriptions entirely — every sale so far was a lifetime purchase.
    db.exec(`ALTER TABLE sales ADD COLUMN product_type TEXT NOT NULL DEFAULT 'lifetime'`);
    db.exec(`ALTER TABLE sales ADD COLUMN stripe_subscription_id TEXT`);
    db.exec(`ALTER TABLE sales ADD COLUMN subscription_status TEXT`);
    db.exec(`ALTER TABLE sales ADD COLUMN current_period_end TEXT`);
  }
  if (!salesColumns.some((c) => c.name === "notes")) {
    // Only ever set for manually-generated keys (no real Stripe payment) — a place to record why
    // (a reviewer copy, a partner deal, a refund goodwill gesture...).
    db.exec(`ALTER TABLE sales ADD COLUMN notes TEXT`);
  }

  const proxyFailoverColumns = db.prepare(`PRAGMA table_info(proxy_failovers)`).all() as { name: string }[];
  if (!proxyFailoverColumns.some((c) => c.name === "mode")) {
    // 'server' (proxy to a real backup target, the original behavior) vs 'page' (serve an inline
    // static maintenance page instead — see lib/npmFailover.ts) — backup_host/backup_port stay
    // NOT NULL in the schema, so 'page' mode just leaves them as empty-string/0 placeholders.
    db.exec(`ALTER TABLE proxy_failovers ADD COLUMN mode TEXT NOT NULL DEFAULT 'server'`);
    db.exec(`ALTER TABLE proxy_failovers ADD COLUMN maintenance_html TEXT`);
  }
  if (!proxyFailoverColumns.some((c) => c.name === "backup_path")) {
    // 'server' mode only — lets the backup target be a specific URL (e.g. /file.html, an
    // instance-specific "down for maintenance" page hosted on the backup itself) instead of always
    // the site root.
    db.exec(`ALTER TABLE proxy_failovers ADD COLUMN backup_path TEXT NOT NULL DEFAULT '/'`);
  }

  ensureVaultKdfSalt(db);
}

/**
 * Pins the vault's key-derivation salt into `settings` on first run, instead of always falling
 * back to a fixed literal baked into the code (see lib/crypto.ts) — every install sharing the
 * same default salt means an attacker who steals one install's DB can reuse offline dictionary
 * work against every other install still on the default. A genuinely fresh install (nothing
 * encrypted yet) gets a random salt. An install upgrading from before this existed already has
 * data encrypted under the old hardcoded literal — for those, the legacy value has to be pinned
 * as-is, or every stored SSH key/password/API token/signing key becomes permanently undecryptable.
 */
/** A small curated set of common self-hosted apps, seeded once as ordinary editable rows — not a
 * hardcoded UI list — so a fresh install starts with useful defaults but a customer can rename,
 * edit, delete, or add their own without touching source code. Never re-seeds an install that
 * already has templates (including one where the customer deleted every built-in on purpose). */
function seedAppTemplatesIfEmpty(db: Database.Database) {
  const { c } = db.prepare(`SELECT COUNT(*) as c FROM app_templates`).get() as { c: number };
  if (c > 0) return;

  const BUILTIN_TEMPLATES = [
    {
      id: "portainer",
      name: "Portainer",
      description: "Interface de gestion Docker complète, en complément de ce panel.",
      image: "portainer/portainer-ce:latest",
      ports: ["9000:9000"],
      volumes: ["/var/run/docker.sock:/var/run/docker.sock", "./portainer/data:/data"],
      env: [],
    },
    {
      id: "pihole",
      name: "Pi-hole",
      description: "Bloqueur de publicités DNS pour tout le réseau local.",
      image: "pihole/pihole:latest",
      ports: ["53:53/tcp", "53:53/udp", "8081:80"],
      volumes: ["./pihole/etc-pihole:/etc/pihole", "./pihole/etc-dnsmasq.d:/etc/dnsmasq.d"],
      env: ["TZ=Europe/Paris", "WEBPASSWORD=changeme"],
    },
    {
      id: "vaultwarden",
      name: "Vaultwarden",
      description: "Serveur Bitwarden léger et auto-hébergé pour la gestion de mots de passe.",
      image: "vaultwarden/server:latest",
      ports: ["8082:80"],
      volumes: ["./vaultwarden/data:/data"],
      env: ["SIGNUPS_ALLOWED=false"],
    },
    {
      id: "uptime-kuma",
      name: "Uptime Kuma",
      description: "Supervision de disponibilité (uptime) avec belles pages de statut.",
      image: "louislam/uptime-kuma:latest",
      ports: ["3001:3001"],
      volumes: ["./uptime-kuma/data:/app/data"],
      env: [],
    },
    {
      id: "adminer",
      name: "Adminer",
      description: "Client web léger pour administrer des bases MySQL/PostgreSQL/SQLite.",
      image: "adminer:latest",
      ports: ["8083:8080"],
      volumes: [],
      env: [],
    },
    {
      id: "watchtower",
      name: "Watchtower",
      description: "Met automatiquement à jour les images des autres conteneurs sur cette machine.",
      image: "containrrr/watchtower:latest",
      ports: [],
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
      env: [],
    },
    {
      id: "homepage",
      name: "Homepage",
      description: "Tableau de bord d'accueil listant tous tes services auto-hébergés.",
      image: "ghcr.io/gethomepage/homepage:latest",
      ports: ["3003:3000"],
      volumes: ["./homepage/config:/app/config"],
      env: [],
    },
    {
      id: "n8n",
      name: "n8n",
      description: "Automatisation de workflows (façon Zapier), auto-hébergée.",
      image: "n8nio/n8n:latest",
      ports: ["5678:5678"],
      volumes: ["./n8n/data:/home/node/.n8n"],
      env: ["TZ=Europe/Paris"],
    },
  ];

  const insert = db.prepare(
    `INSERT INTO app_templates (id, name, description, image, ports_json, volumes_json, env_json, restart_policy)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unless-stopped')`
  );
  const insertAll = db.transaction((templates: typeof BUILTIN_TEMPLATES) => {
    for (const t of templates) {
      insert.run(t.id, t.name, t.description, t.image, JSON.stringify(t.ports), JSON.stringify(t.volumes), JSON.stringify(t.env));
    }
  });
  insertAll(BUILTIN_TEMPLATES);
}

function ensureVaultKdfSalt(db: Database.Database) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = 'vault_kdf_salt'`).get();
  if (existing) return;

  const LEGACY_DEFAULT_SALT = "homelab-panel-vault";
  const hasExistingSecrets =
    db.prepare(`SELECT 1 FROM credentials LIMIT 1`).get() ||
    db.prepare(`SELECT 1 FROM backup_ssh_key LIMIT 1`).get() ||
    db.prepare(`SELECT 1 FROM license_signing_key LIMIT 1`).get() ||
    db.prepare(`SELECT 1 FROM users WHERE totp_secret_encrypted IS NOT NULL LIMIT 1`).get();

  const salt = hasExistingSecrets ? LEGACY_DEFAULT_SALT : randomBytes(16).toString("hex");
  db.prepare(`INSERT INTO settings (key, value) VALUES ('vault_kdf_salt', ?)`).run(salt);
}

export function logAudit(action: string, target?: string, detail?: string) {
  getDb()
    .prepare(`INSERT INTO audit_log (action, target, detail) VALUES (?, ?, ?)`)
    .run(action, target ?? null, detail ?? null);
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value);
}
