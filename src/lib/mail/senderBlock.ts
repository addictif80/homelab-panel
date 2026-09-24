import { getDb } from "../db";
import { runSshCommand, shellQuote } from "../ssh";
import { withTimeout } from "../timeout";

const BLOCK_TIMEOUT_MS = 20_000;
const ACCESS_MAP_PATH = "/etc/postfix/sender_access";

export function recordBlockedSender(email: string): void {
  getDb()
    .prepare(`INSERT INTO blocked_senders (email, blocked_at) VALUES (?, datetime('now')) ON CONFLICT(email) DO NOTHING`)
    .run(email);
}

export function forgetBlockedSender(email: string): void {
  getDb().prepare(`DELETE FROM blocked_senders WHERE email = ?`).run(email);
}

export function listBlockedSenders(): { email: string; blockedAt: string }[] {
  return getDb()
    .prepare(`SELECT email, blocked_at as blockedAt FROM blocked_senders ORDER BY blocked_at DESC`)
    .all() as { email: string; blockedAt: string }[];
}

export type SenderBlockResult = { hostId: number; hostName: string; ok: boolean; message: string };

/**
 * Appends the address to a Postfix `check_sender_access` map on every SSH-reachable host that has
 * Postfix installed, then rebuilds the map and reloads — the closest thing to a universal
 * mechanism across self-hosted mail stacks, since virtually all of them (Mailcow, Mail-in-a-Box,
 * iRedMail, Modoboa, a hand-rolled setup) run Postfix as the actual MTA even when something else
 * (rspamd, SpamAssassin) does the content filtering. Deliberately never edits main.cf to wire the
 * map into smtpd_sender_restrictions — that's a one-time step the admin should review themselves,
 * since an unreviewed edit to mail routing/restriction config on someone else's production mail
 * server is a very different risk than a firewall DROP rule. If main.cf doesn't already reference
 * this map, the entry is still recorded (harmless) but the result says so, so the block doesn't
 * silently appear to have worked when it hasn't actually taken effect yet.
 */
export async function blockSenderEverywhere(
  email: string,
  onHostResult?: (result: SenderBlockResult) => void
): Promise<SenderBlockResult[]> {
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      let result: SenderBlockResult;
      try {
        const message = await applyBlockSender(host.id, email);
        result = { hostId: host.id, hostName: host.name, ok: true, message };
      } catch (err) {
        result = {
          hostId: host.id,
          hostName: host.name,
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue.",
        };
      }
      onHostResult?.(result);
      return result;
    })
  );
  recordBlockedSender(email);
  return results;
}

export async function unblockSenderEverywhere(
  email: string,
  onHostResult?: (result: SenderBlockResult) => void
): Promise<SenderBlockResult[]> {
  const hosts = getDb().prepare(`SELECT id, name FROM hosts ORDER BY kind, name`).all() as {
    id: number;
    name: string;
  }[];

  const results = await Promise.all(
    hosts.map(async (host) => {
      let result: SenderBlockResult;
      try {
        const message = await applyUnblockSender(host.id, email);
        result = { hostId: host.id, hostName: host.name, ok: true, message };
      } catch (err) {
        result = {
          hostId: host.id,
          hostName: host.name,
          ok: false,
          message: err instanceof Error ? err.message : "Erreur inconnue.",
        };
      }
      onHostResult?.(result);
      return result;
    })
  );
  forgetBlockedSender(email);
  return results;
}

async function applyBlockSender(hostId: number, email: string): Promise<string> {
  const command = [
    `command -v postconf >/dev/null 2>&1 || { echo homelab_no_postfix; exit 0; }`,
    `MAP=${shellQuote(ACCESS_MAP_PATH)}`,
    `EMAIL=${shellQuote(email)}`,
    `touch "$MAP"`,
    `grep -qxF "$EMAIL REJECT" "$MAP" || echo "$EMAIL REJECT" >> "$MAP"`,
    `postmap "$MAP" 2>&1`,
    `(systemctl reload postfix 2>/dev/null || postfix reload 2>/dev/null || true)`,
    `postconf -n smtpd_sender_restrictions smtpd_recipient_restrictions 2>/dev/null | grep -q "check_sender_access" && echo homelab_wired || echo homelab_not_wired`,
  ].join("\n");

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du blocage de l'expéditeur."
  );
  if (stdout.includes("homelab_no_postfix")) throw new Error("Postfix n'est pas installé sur cette machine.");
  if (code !== 0) throw new Error(stderr || "Échec de l'ajout à la liste de blocage Postfix.");

  if (stdout.includes("homelab_wired")) {
    return `${email} bloqué (Postfix rechargé, la règle est active).`;
  }
  return `${email} ajouté à ${ACCESS_MAP_PATH}, mais ce fichier n'est référencé par aucune restriction Postfix (smtpd_sender_restrictions) — ajoutez-y "check_sender_access hash:${ACCESS_MAP_PATH}" dans main.cf pour que le blocage prenne effet.`;
}

async function applyUnblockSender(hostId: number, email: string): Promise<string> {
  const command = [
    `command -v postconf >/dev/null 2>&1 || { echo homelab_no_postfix; exit 0; }`,
    `MAP=${shellQuote(ACCESS_MAP_PATH)}`,
    `EMAIL=${shellQuote(email)}`,
    `[ -f "$MAP" ] && sed -i "\\|^$(printf '%s' "$EMAIL" | sed 's/[.[\\*^$/]/\\\\&/g') REJECT$|d" "$MAP" || true`,
    `[ -f "$MAP" ] && postmap "$MAP" 2>&1 || true`,
    `(systemctl reload postfix 2>/dev/null || postfix reload 2>/dev/null || true)`,
  ].join("\n");

  const { stdout, code, stderr } = await withTimeout(
    runSshCommand(hostId, command, { sudo: true }),
    BLOCK_TIMEOUT_MS,
    "Délai dépassé lors du déblocage de l'expéditeur."
  );
  if (stdout.includes("homelab_no_postfix")) return "Postfix absent, rien à débloquer.";
  if (code !== 0) throw new Error(stderr || "Échec du retrait de la liste de blocage Postfix.");
  return `${email} débloqué.`;
}
