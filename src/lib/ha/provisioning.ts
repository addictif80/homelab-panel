import { runSshCommand, shellQuote } from "../ssh";
import { type Replication, type ProvisionPreset } from "./replication";

export const PROVISION_PRESETS: { id: ProvisionPreset; label: string; needsDomain: boolean; needsPhpVersion: boolean }[] = [
  { id: "docker_lemp", label: "Docker (nginx + php-fpm + mysql)", needsDomain: true, needsPhpVersion: true },
  { id: "apache_native", label: "Apache natif", needsDomain: true, needsPhpVersion: true },
  { id: "nginx_native", label: "Nginx natif", needsDomain: true, needsPhpVersion: true },
  { id: "custom", label: "Commande personnalisée (avancé)", needsDomain: false, needsPhpVersion: false },
];

export const PROVISION_PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3"];

const PROVISION_TIMEOUT_MS = 60_000;

/** Variables available to a "custom" provisioning command, substituted as plain ${NAME}
 * placeholders — deliberately a flat string replace, not a templating engine: the command is the
 * user's own, run on their own infrastructure over credentials they already control, so this adds
 * no new trust boundary beyond what every other SSH action in this panel already crosses. */
function substitutePlaceholders(template: string, r: Replication): string {
  return template
    .replaceAll("${DOMAIN}", r.provisionDomain ?? "")
    .replaceAll("${TARGET_PATH}", r.targetPath)
    .replaceAll("${SOURCE_PATH}", r.sourcePath)
    .replaceAll("${REPLICATION_NAME}", r.name)
    .replaceAll("${PHP_VERSION}", r.provisionPhpVersion ?? "");
}

/** The Docker preset assumes the opinionated stack this panel's own docs walk a user through
 * setting up on the failover host: one shared nginx container named `failover-web` serving every
 * site's vhost out of `/opt/failover-site/nginx/conf.d`, and one php-fpm container per PHP version
 * named `failover-php<version-without-dot>` (e.g. "8.2" → `failover-php82`). Nothing here deploys
 * that stack itself — only the per-site vhost, once it already exists. */
function dockerLempCommand(r: Replication): string {
  const domain = r.provisionDomain!.trim();
  const phpContainer = `failover-php${(r.provisionPhpVersion ?? "8.2").replace(".", "")}`;
  const confPath = `/opt/failover-site/nginx/conf.d/${domain}.conf`;
  const vhost = `server {
    listen 80;
    server_name ${domain};
    root ${r.targetPath};
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }
    location ~ \\.php$ {
        fastcgi_pass ${phpContainer}:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}`;
  return [
    `mkdir -p ${shellQuote(r.targetPath)} /opt/failover-site/nginx/conf.d`,
    `cat > ${shellQuote(confPath)} <<'HLP_VHOST_EOF'\n${vhost}\nHLP_VHOST_EOF`,
    `docker exec failover-web nginx -t`,
    `docker exec failover-web nginx -s reload`,
  ].join(" && ");
}

function apacheNativeCommand(r: Replication): string {
  const domain = r.provisionDomain!.trim();
  const phpVersion = r.provisionPhpVersion ?? "8.2";
  const confPath = `/etc/apache2/sites-available/${domain}.conf`;
  const vhost = `<VirtualHost *:80>
    ServerName ${domain}
    DocumentRoot ${r.targetPath}
    <Directory ${r.targetPath}>
        AllowOverride All
        Require all granted
    </Directory>
    <FilesMatch "\\.php$">
        SetHandler "proxy:unix:/run/php/php${phpVersion}-fpm.sock|fcgi://localhost"
    </FilesMatch>
</VirtualHost>`;
  return [
    `mkdir -p ${shellQuote(r.targetPath)}`,
    `cat > ${shellQuote(confPath)} <<'HLP_VHOST_EOF'\n${vhost}\nHLP_VHOST_EOF`,
    `a2enmod proxy_fcgi setenvif >/dev/null 2>&1 || true`,
    `a2ensite ${shellQuote(`${domain}.conf`)}`,
    `apachectl configtest`,
    `systemctl reload apache2`,
  ].join(" && ");
}

function nginxNativeCommand(r: Replication): string {
  const domain = r.provisionDomain!.trim();
  const phpVersion = r.provisionPhpVersion ?? "8.2";
  const confPath = `/etc/nginx/sites-available/${domain}.conf`;
  const vhost = `server {
    listen 80;
    server_name ${domain};
    root ${r.targetPath};
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }
    location ~ \\.php$ {
        fastcgi_pass unix:/run/php/php${phpVersion}-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}`;
  return [
    `mkdir -p ${shellQuote(r.targetPath)}`,
    `cat > ${shellQuote(confPath)} <<'HLP_VHOST_EOF'\n${vhost}\nHLP_VHOST_EOF`,
    `ln -sf ${shellQuote(confPath)} ${shellQuote(`/etc/nginx/sites-enabled/${domain}.conf`)}`,
    `nginx -t`,
    `systemctl reload nginx`,
  ].join(" && ");
}

/** Null when provisioning isn't configured for this replication (provisionPreset unset), when the
 * chosen preset needs fields that aren't filled in, or for a kind other than 'folder' — vhost
 * provisioning only makes sense for a web docroot being mirrored, not a database/sqlite target. */
export function buildProvisionCommand(r: Replication): string | null {
  if (r.kind !== "folder" || !r.provisionPreset) return null;
  if (r.provisionPreset === "custom") {
    return r.provisionCommand ? substitutePlaceholders(r.provisionCommand, r) : null;
  }
  if (!r.provisionDomain?.trim()) return null;
  if (r.provisionPreset === "docker_lemp") return dockerLempCommand(r);
  if (r.provisionPreset === "apache_native") return apacheNativeCommand(r);
  return nginxNativeCommand(r);
}

export type ProvisionResult = { ok: boolean; detail: string };

/** Runs the provisioning command (if any) on the replication's target host — best-effort by
 * design: called right after a folder replication's first successful sync, where the sync itself
 * having worked is the part that actually matters. A provisioning failure (a typo in a custom
 * command, Apache not installed on a host where the "Apache natif" preset was picked by mistake...)
 * is surfaced to the caller to append as a warning, never as a reason to mark the whole replication
 * "error" when the files did, in fact, arrive. */
export async function runProvisioning(r: Replication): Promise<ProvisionResult | null> {
  const command = buildProvisionCommand(r);
  if (!command) return null;
  const { code, stdout, stderr } = await runSshCommand(r.targetHostId, command, {
    sudo: true,
    timeoutMs: PROVISION_TIMEOUT_MS,
  });
  if (code !== 0) {
    return { ok: false, detail: (stderr || stdout || "Échec du provisioning, sans détail.").trim() };
  }
  return { ok: true, detail: "Provisioning du serveur web effectué sur la machine cible." };
}
