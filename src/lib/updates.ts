import { Client as SshClient } from "ssh2";
import { buildSshConfig, buildPrivilegedCommand } from "./ssh";

export type UpdateMethod = "apt" | "opkg" | "dsm";
export type UpdateMode = "dry-run" | "apply";

type CommandSet = {
  dryRun: string;
  apply: string;
  /** Marker printed to stdout when a reboot is needed; null if the method never triggers one. */
  rebootCheck: string | null;
  supportsAutoReboot: boolean;
};

const REBOOT_MARKER = "__HOMELAB_REBOOT_REQUIRED__";

const COMMANDS: Record<UpdateMethod, CommandSet> = {
  apt: {
    dryRun: "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get -s dist-upgrade",
    apply:
      "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get -y dist-upgrade && apt-get -y autoremove",
    rebootCheck: `test -f /var/run/reboot-required && echo ${REBOOT_MARKER} || true`,
    supportsAutoReboot: true,
  },
  opkg: {
    dryRun: "opkg update && opkg list-upgradable",
    apply: "opkg update; opkg list-upgradable | cut -f1 -d' ' | xargs -r -n1 opkg upgrade",
    // Never auto-reboot the router: it would cut off access to every other machine mid-update.
    rebootCheck: null,
    supportsAutoReboot: false,
  },
  dsm: {
    dryRun:
      "/usr/syno/bin/synoupgrade --check 2>/dev/null || echo 'Vérification DSM non disponible via SSH standard sur ce modèle.'",
    apply:
      "echo 'Mise à jour DSM à confirmer manuellement : Panneau de configuration > Mise à jour et restauration.'",
    rebootCheck: null,
    supportsAutoReboot: false,
  },
};

export function buildUpdateCommand(
  method: UpdateMethod,
  mode: UpdateMode,
  allowAutoReboot: boolean
): string {
  const set = COMMANDS[method];
  if (!set) throw new Error(`Méthode de mise à jour inconnue: ${method}`);

  const base = mode === "dry-run" ? set.dryRun : set.apply;
  if (mode === "dry-run" || !set.rebootCheck) return base;

  // On apply: check whether a reboot is needed, and either just report it or trigger a
  // delayed reboot (delayed so the SSH exec channel returns cleanly before the box goes down).
  const rebootAction = allowAutoReboot && set.supportsAutoReboot
    ? `if [ "$reboot_check" = "${REBOOT_MARKER}" ]; then echo 'Redémarrage requis, planifié dans 5s...'; nohup sh -c 'sleep 5 && reboot' >/dev/null 2>&1 & fi`
    : `if [ "$reboot_check" = "${REBOOT_MARKER}" ]; then echo 'Redémarrage requis (non appliqué automatiquement).'; fi`;

  return `${base}; reboot_check=$(${set.rebootCheck}); ${rebootAction}`;
}

export function streamSshCommand(hostId: number, rawCommand: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      let config;
      let command: string;
      let stdinPassword: string | null;
      try {
        config = buildSshConfig(hostId);
        ({ command, stdinPassword } = buildPrivilegedCommand(hostId, rawCommand));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${err instanceof Error ? err.message : "Erreur"}\n\n`)
        );
        controller.close();
        return;
      }

      const conn = new SshClient();

      const sendLine = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          if (line.length === 0) continue;
          controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        }
      };

      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${err.message}\n\n`));
            controller.close();
            conn.end();
            return;
          }
          if (stdinPassword) stream.write(`${stdinPassword}\n`);
          stream.on("data", (data: Buffer) => sendLine(data.toString("utf8")));
          stream.stderr.on("data", (data: Buffer) => sendLine(data.toString("utf8")));
          stream.on("close", (code: number) => {
            controller.enqueue(encoder.encode(`event: done\ndata: ${code}\n\n`));
            controller.close();
            conn.end();
          });
        });
      });

      conn.on("error", (err) => {
        controller.enqueue(encoder.encode(`event: error\ndata: ${err.message}\n\n`));
        controller.close();
      });

      conn.connect(config);
    },
  });
}
