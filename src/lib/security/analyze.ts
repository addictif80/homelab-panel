import type { Finding, HostFacts } from "./types";

export type HostForAnalysis = {
  id: number;
  kind: string;
  os: string | null;
  update_method: string | null;
  docker_enabled: number;
  ssh_port: number;
};

const DB_PORTS = new Set([3306, 5432, 6379, 27017, 5984, 9200, 11211, 1433]);

function line(facts: HostFacts, section: string): string {
  return facts[section] ?? "";
}

function sshdValue(sshdSection: string, key: string): string | null {
  const match = sshdSection.match(new RegExp(`^${key}\\s+(\\S+)`, "im"));
  return match ? match[1].toLowerCase() : null;
}

/** Turns raw facts collected over SSH into plain-language findings a non-expert can act on. */
export function analyzeHost(host: HostForAnalysis, facts: HostFacts): Finding[] {
  const findings: Finding[] = [];
  const isApt = host.update_method === "apt";
  const isRouter = host.kind === "router";
  const isDsm = host.update_method === "dsm";

  // --- SSH ---
  const sshd = line(facts, "SSHD");
  if (sshd) {
    const rootLogin = sshdValue(sshd, "permitrootlogin");
    if (rootLogin === "yes") {
      findings.push({
        id: "ssh-root-password",
        category: "ssh",
        severity: "critical",
        title: "La connexion root par mot de passe est autorisée en SSH",
        detail:
          "N'importe qui qui devine ou trouve le mot de passe root peut prendre le contrôle total de cette machine. C'est l'une des cibles préférées des robots qui scannent Internet en continu.",
      });
    }
    const passwordAuth = sshdValue(sshd, "passwordauthentication");
    if (passwordAuth === "yes") {
      findings.push({
        id: "ssh-password-auth",
        category: "ssh",
        severity: "warning",
        title: "La connexion SSH par mot de passe est activée",
        detail:
          "Se connecter avec une clé SSH (plutôt qu'un mot de passe) rend le piratage par force brute quasiment impossible, même avec un mot de passe faible. À ne désactiver qu'une fois qu'une clé fonctionne, sinon tu perds l'accès à la machine.",
      });
    }
  }

  const fail2ban = line(facts, "FAIL2BAN");
  if (fail2ban && !fail2ban.includes("active") && !isRouter && !isDsm) {
    findings.push({
      id: "fail2ban-missing",
      category: "ssh",
      severity: "warning",
      title: "Aucune protection contre les tentatives de connexion répétées",
      detail:
        "Fail2ban bannit automatiquement une adresse IP après plusieurs échecs de connexion SSH, ce qui bloque la plupart des attaques automatisées (\"bruteforce\"). Il n'est pas installé ou n'est pas actif sur cette machine.",
      fixId: "install-fail2ban",
      fixLabel: "Installer et activer fail2ban",
    });
  }

  // --- Firewall ---
  if (!isRouter && !isDsm) {
    const ufw = line(facts, "UFW");
    const iptables = line(facts, "IPTABLES");
    const nft = line(facts, "NFT");
    const ufwActive = /status:\s*active/i.test(ufw);
    // A default iptables ruleset (no custom chains/rules) prints only the three default
    // ACCEPT policies — anything beyond that means real rules exist.
    const iptablesHasRules = iptables.split("\n").filter((l) => l.trim()).length > 3;
    const nftHasRules = nft.trim().length > 0;
    if (!ufwActive && !iptablesHasRules && !nftHasRules) {
      findings.push({
        id: "no-firewall",
        category: "firewall",
        severity: "critical",
        title: "Aucun pare-feu actif détecté",
        detail:
          "Sans pare-feu, tous les services qui écoutent sur cette machine sont potentiellement joignables depuis l'extérieur. Un pare-feu de base bloque tout le trafic entrant sauf ce qui est explicitement autorisé (comme le port SSH).",
        fixId: "basic-firewall",
        fixLabel: "Activer un pare-feu de base",
        fixWarning: `Cette action autorise uniquement le port SSH ${host.ssh_port} et le trafic déjà établi, puis bloque le reste en entrée. Le panel garde l'accès SSH, mais tout autre service exposé sur cette machine (site web, API...) sera bloqué tant que tu n'auras pas ajouté une règle pour lui.`,
      });
    }
  }

  // --- Updates ---
  if (isApt) {
    const pendingRaw = line(facts, "APT_PENDING");
    const pending = parseInt(pendingRaw, 10) || 0;
    if (pending > 0) {
      findings.push({
        id: "apt-updates-pending",
        category: "updates",
        severity: pending > 20 ? "critical" : "warning",
        title: `${pending} mise${pending > 1 ? "s" : ""} à jour en attente`,
        detail:
          "Les mises à jour corrigent des failles de sécurité connues. Plus elles s'accumulent, plus la machine est exposée à des vulnérabilités déjà documentées et exploitées par des attaquants.",
        fixId: "apply-updates",
        fixLabel: "Appliquer les mises à jour",
        fixWarning:
          "Lance une vraie mise à jour système (comme depuis la page Mises à jour). Une machine peut redémarrer certains services ; en cas de mise à jour du noyau, un redémarrage complet peut être nécessaire ensuite.",
      });
    }
    const unattended = line(facts, "UNATTENDED");
    if (!unattended.includes("installed")) {
      findings.push({
        id: "unattended-upgrades-missing",
        category: "updates",
        severity: "info",
        title: "Les mises à jour de sécurité ne s'installent pas toutes seules",
        detail:
          "Avec unattended-upgrades, les correctifs de sécurité Debian/Ubuntu s'installent automatiquement dès qu'ils sortent, sans attendre que tu viennes cliquer sur \"Mettre à jour\".",
        fixId: "install-unattended-upgrades",
        fixLabel: "Activer les mises à jour de sécurité automatiques",
      });
    }
  } else if (isRouter) {
    const pending = parseInt(line(facts, "OPKG_PENDING"), 10) || 0;
    if (pending > 0) {
      findings.push({
        id: "opkg-updates-pending",
        category: "updates",
        severity: "warning",
        title: `${pending} paquet${pending > 1 ? "s" : ""} du routeur en attente de mise à jour`,
        detail:
          "Ton routeur est la porte d'entrée de tout ton réseau : le garder à jour est particulièrement important. Mets-le à jour depuis la page Mises à jour (liste basée sur le dernier `opkg update`, pense à le relancer si ça fait longtemps).",
      });
    }
  } else if (isDsm) {
    findings.push({
      id: "dsm-manual-check",
      category: "updates",
      severity: "info",
      title: "Vérifie manuellement les mises à jour DSM",
      detail:
        "Synology ne permet pas de vérifier les mises à jour de façon fiable en ligne de commande. Ouvre le Panneau de configuration DSM > Mise à jour et restauration de temps en temps.",
    });
  }

  // --- Accounts ---
  const uid0Users = line(facts, "UID0")
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u && u !== "root");
  if (uid0Users.length > 0) {
    findings.push({
      id: "duplicate-uid0",
      category: "accounts",
      severity: "critical",
      title: `Compte(s) avec les droits root en plus de "root" : ${uid0Users.join(", ")}`,
      detail:
        "Normalement, un seul compte (root) a le niveau d'accès maximal. Un autre compte avec le même niveau peut être une porte dérobée laissée par une intrusion, ou un compte oublié. À vérifier toi-même : cette action n'est pas automatisable en toute sécurité.",
    });
  }

  const emptyPassAccounts = line(facts, "EMPTYPASS")
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  if (emptyPassAccounts.length > 0) {
    findings.push({
      id: "empty-password-accounts",
      category: "accounts",
      severity: "critical",
      title: `Compte(s) sans mot de passe : ${emptyPassAccounts.join(", ")}`,
      detail:
        "N'importe qui ayant un accès local (ou parfois distant) peut se connecter à ce compte sans rien taper. Il faut lui définir un mot de passe (`passwd <utilisateur>`) ou le désactiver.",
    });
  }

  const nopasswdLines = line(facts, "NOPASSWD")
    .split("\n")
    .filter(Boolean);
  if (nopasswdLines.length > 0) {
    findings.push({
      id: "passwordless-sudo",
      category: "accounts",
      severity: "warning",
      title: "Au moins un utilisateur peut devenir root sans mot de passe (sudo NOPASSWD)",
      detail:
        "Si le compte de cet utilisateur est compromis (mot de passe volé, clé SSH copiée...), l'attaquant obtient directement les droits root sans effort supplémentaire. À restreindre aux seules commandes qui en ont vraiment besoin si possible.",
    });
  }

  // --- Network exposure ---
  const listen = line(facts, "LISTEN");
  if (listen) {
    const exposedDbPorts = new Set<number>();
    for (const l of listen.split("\n")) {
      const match = l.match(/(?:0\.0\.0\.0|\*|::):(\d+)\b/);
      if (!match) continue;
      const port = parseInt(match[1], 10);
      if (DB_PORTS.has(port)) exposedDbPorts.add(port);
    }
    if (exposedDbPorts.size > 0) {
      findings.push({
        id: "sensitive-service-exposed",
        category: "network",
        severity: host.kind === "vps" ? "critical" : "warning",
        title: `Service sensible accessible depuis l'extérieur (port ${[...exposedDbPorts].join(", ")})`,
        detail:
          "Un port de base de données écoute sur toutes les interfaces réseau au lieu de rester local (127.0.0.1) ou d'être derrière un pare-feu. Ces services sont des cibles fréquentes pour le vol de données quand ils sont directement accessibles depuis Internet.",
      });
    }
  }

  if (host.docker_enabled) {
    const dockerPorts = line(facts, "DOCKERPORTS");
    const risky: string[] = [];
    for (const l of dockerPorts.split("\n")) {
      if (!l.includes("|")) continue;
      const [name, ports] = l.split("|");
      const matches = [...ports.matchAll(/0\.0\.0\.0:(\d+)->/g)].map((m) => parseInt(m[1], 10));
      const nonWeb = matches.filter((p) => p !== 80 && p !== 443);
      if (nonWeb.length > 0) risky.push(`${name.trim()} (${nonWeb.join(", ")})`);
    }
    if (risky.length > 0) {
      findings.push({
        id: "docker-exposed-ports",
        category: "docker",
        severity: "warning",
        title: `Conteneur(s) Docker exposés sur des ports inhabituels : ${risky.join(", ")}`,
        detail:
          "Ces conteneurs publient un port directement sur toutes les interfaces réseau. Vérifie que ce service est bien censé être accessible depuis l'extérieur ; sinon, publie-le uniquement sur 127.0.0.1 ou retire le mappage de port.",
      });
    }
  }

  return findings;
}

export function scoreFindings(findings: Finding[]): "critical" | "warning" | "good" {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "good";
}
