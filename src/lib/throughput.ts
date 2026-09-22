import { randomUUID } from "crypto";
import { getDb, getSetting, setSetting } from "./db";
import { getHostConnectionInfo, runSshCommand } from "./ssh";
import { ensurePrivateKeyDeployed, ensurePublicKeyAuthorized } from "./backup/keys";

const RUNNING_KEY = "throughput_test_running_run_id";
// Big enough that TCP's slow-start ramp-up isn't most of the transfer, small enough to still be
// quick on a slow link or a small VPS's disk-backed /tmp.
const TEST_SIZE_MB = 64;

export type ThroughputPairResult = {
  sourceHostId: number;
  sourceHostName: string;
  targetHostId: number;
  targetHostName: string;
  mbps: number | null;
  error: string | null;
  testedAt: string;
};

type TestableHost = { id: number; name: string };

function getTestableHosts(): TestableHost[] {
  return getDb()
    .prepare(`SELECT id, name FROM hosts WHERE kind IN ('physical','vps','nas') ORDER BY name`)
    .all() as TestableHost[];
}

/** Pipes TEST_SIZE_MB of zeroed data from the source host, over its own SSH connection, straight
 * into the target host via a nested `ssh ... "cat > /dev/null"` — reusing the backup feature's own
 * dedicated keypair (see lib/backup/keys.ts) rather than provisioning a second one, since it's
 * already exactly "one machine can push bytes to another over SSH" with no destination-side setup
 * beyond authorizing a key. Measured as wall-clock time for the whole pipe on the source host, so
 * the number reflects the real path between the two machines, not a synthetic loopback. */
async function testPair(sourceId: number, targetId: number): Promise<{ mbps: number | null; error: string | null }> {
  try {
    // Sequential, not Promise.all: both calls lazily create the same singleton backup keypair
    // (lib/backup/keys.ts) on first use, and running them concurrently races two inserts of the
    // same row — the same reason lib/backup/transfer.ts awaits them one at a time.
    const keyPath = await ensurePrivateKeyDeployed(sourceId);
    await ensurePublicKeyAuthorized(targetId);
    const { address, port, user } = getHostConnectionInfo(targetId);
    const command = [
      `START=$(date +%s%N)`,
      `dd if=/dev/zero bs=1M count=${TEST_SIZE_MB} 2>/dev/null | ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p ${port} ${user}@${address} "cat > /dev/null"`,
      `END=$(date +%s%N)`,
      `echo "___THROUGHPUT_NS___$((END-START))"`,
    ].join("\n");
    const { stdout, stderr, code } = await runSshCommand(sourceId, command, { timeoutMs: 30_000 });
    if (code !== 0) return { mbps: null, error: stderr.trim() || "Échec du transfert de test." };
    const match = stdout.match(/___THROUGHPUT_NS___(\d+)/);
    if (!match) return { mbps: null, error: "Résultat illisible — vérifie que ssh/dd sont disponibles sur la machine source." };
    const elapsedNs = Number(match[1]);
    if (!Number.isFinite(elapsedNs) || elapsedNs <= 0) return { mbps: null, error: "Durée de transfert invalide." };
    const elapsedSeconds = elapsedNs / 1e9;
    const mbps = (TEST_SIZE_MB * 8) / elapsedSeconds; // mégaoctets -> mégabits, / secondes
    return { mbps, error: null };
  } catch (err) {
    return { mbps: null, error: err instanceof Error ? err.message : "Erreur inconnue." };
  }
}

export function getCurrentRunId(): string | null {
  return getSetting(RUNNING_KEY) || null;
}

export function getRunResults(runId: string): ThroughputPairResult[] {
  return getDb()
    .prepare(
      `SELECT t.source_host_id as sourceHostId, sh.name as sourceHostName,
              t.target_host_id as targetHostId, th.name as targetHostName,
              t.mbps, t.error, t.tested_at as testedAt
       FROM throughput_tests t
       JOIN hosts sh ON sh.id = t.source_host_id
       JOIN hosts th ON th.id = t.target_host_id
       WHERE t.run_id = ?
       ORDER BY t.id ASC`
    )
    .all(runId) as ThroughputPairResult[];
}

export function getLatestRunId(): string | null {
  const row = getDb().prepare(`SELECT run_id as runId FROM throughput_tests ORDER BY id DESC LIMIT 1`).get() as
    | { runId: string }
    | undefined;
  return row?.runId ?? null;
}

export function getPairCount(): number {
  return getTestableHosts().length ** 2 - getTestableHosts().length;
}

/** Every ordered pair, sequentially — running transfers concurrently would have them compete for
 * the same NICs/switch/WAN link and measure contention, not each link's real capacity. Manual-
 * trigger only, like the security scan: N hosts means N×(N-1) transfers of real data, never
 * something to run on a schedule in the background. */
export async function runFleetThroughputMatrix(): Promise<string> {
  if (getSetting(RUNNING_KEY)) throw new Error("Un test de débit est déjà en cours.");
  const hosts = getTestableHosts();
  const runId = randomUUID();
  setSetting(RUNNING_KEY, runId);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO throughput_tests (run_id, source_host_id, target_host_id, mbps, error) VALUES (?, ?, ?, ?, ?)`
  );

  void (async () => {
    try {
      for (const source of hosts) {
        for (const target of hosts) {
          if (source.id === target.id) continue;
          const { mbps, error } = await testPair(source.id, target.id);
          insert.run(runId, source.id, target.id, mbps, error);
        }
      }
    } finally {
      setSetting(RUNNING_KEY, "");
    }
  })();

  return runId;
}
