import { runSshCommand } from "../ssh";
import { withTimeout } from "../timeout";
import type { HostFacts } from "./types";

// Every probe below is best-effort and guarded so a missing tool (e.g. no `ufw` on a NAS, no
// `docker` on a bare VM) never aborts the rest of the script — each line degrades to an empty
// section instead of a hard failure. Nothing here mutates the host.
const FACTS_SCRIPT = `
set +e
echo '###SSHD###'
sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|passwordauthentication|port) '
echo '###FAIL2BAN###'
(systemctl is-active fail2ban 2>/dev/null) || (service fail2ban status >/dev/null 2>&1 && echo active) || echo inactive
echo '###UFW###'
command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1
echo '###IPTABLES###'
iptables -S 2>/dev/null
echo '###NFT###'
command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null
echo '###UNATTENDED###'
dpkg -l unattended-upgrades 2>/dev/null | awk '$1=="ii"{print "installed"}'
echo '###APT_PENDING###'
command -v apt-get >/dev/null 2>&1 && apt-get -s dist-upgrade 2>/dev/null | grep -c '^Inst '
echo '###OPKG_PENDING###'
command -v opkg >/dev/null 2>&1 && opkg list-upgradable 2>/dev/null | wc -l
echo '###UID0###'
awk -F: '$3==0{print $1}' /etc/passwd 2>/dev/null
echo '###EMPTYPASS###'
awk -F: '($2==""){print $1}' /etc/shadow 2>/dev/null
echo '###NOPASSWD###'
grep -Rhs 'NOPASSWD' /etc/sudoers /etc/sudoers.d/ 2>/dev/null | grep -v '^#'
echo '###LISTEN###'
ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null
echo '###DOCKERPORTS###'
command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null
echo '###DHCP###'
if command -v uci >/dev/null 2>&1; then
  echo "uci_ignore=$(uci get dhcp.lan.ignore 2>/dev/null || echo 0)"
fi
pgrep -x dnsmasq >/dev/null 2>&1 && echo "dnsmasq=running" || echo "dnsmasq=stopped"
echo '###END###'
`.trim();

const SECTION_RE = /###([A-Z0-9_]+)###\n?/g;

function parseSections(raw: string): HostFacts {
  const markers: { name: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = SECTION_RE.exec(raw)) !== null) {
    markers.push({ name: match[1], index: match.index + match[0].length });
  }
  const facts: HostFacts = {};
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? raw.lastIndexOf("###", markers[i + 1].index) : raw.length;
    facts[markers[i].name] = raw.slice(start, end).trim();
  }
  return facts;
}

const FACTS_TIMEOUT_MS = 15_000;

export async function collectHostFacts(hostId: number): Promise<HostFacts> {
  const { stdout } = await withTimeout(
    runSshCommand(hostId, FACTS_SCRIPT, { sudo: true }),
    FACTS_TIMEOUT_MS,
    "Délai dépassé lors de l'analyse de sécurité."
  );
  return parseSections(stdout);
}
