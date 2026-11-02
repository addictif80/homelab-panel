import { execOnHostClean } from "./docker";

export type IncusInstance = {
  name: string;
  status: string;
  type: string;
};

export async function listIncusInstances(hostId: number): Promise<IncusInstance[]> {
  const { stdout, stderr, code } = await execOnHostClean(hostId, `incus list --format json`);
  if (code !== 0) throw new Error(stderr || "Erreur Incus.");

  const raw = JSON.parse(stdout) as { name: string; status: string; type: string }[];
  return raw.map((i) => ({ name: i.name, status: i.status, type: i.type }));
}
