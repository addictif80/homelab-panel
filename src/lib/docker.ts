import { runSshCommand, shellQuote } from "./ssh";

function execOnHost(hostId: number, rawCommand: string) {
  return runSshCommand(hostId, rawCommand, { sudo: true });
}

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
};

export async function listContainers(hostId: number): Promise<DockerContainer[]> {
  const { stdout, stderr, code } = await execOnHost(
    hostId,
    `docker ps -a --format '{{json .}}'`
  );
  if (code !== 0) throw new Error(stderr || "Erreur Docker.");

  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line);
      return {
        id: raw.ID,
        name: raw.Names,
        image: raw.Image,
        status: raw.Status,
        state: raw.State,
        ports: raw.Ports,
        createdAt: raw.CreatedAt,
      };
    });
}

export async function containerAction(
  hostId: number,
  containerId: string,
  action: "start" | "stop" | "restart" | "remove"
): Promise<void> {
  const cmd = action === "remove" ? `docker rm -f ${shellQuote(containerId)}` : `docker ${action} ${shellQuote(containerId)}`;
  const { stderr, code } = await execOnHost(hostId, cmd);
  if (code !== 0) throw new Error(stderr || "Erreur Docker.");
}

export async function containerLogs(hostId: number, containerId: string, tail = 200): Promise<string> {
  const { stdout, stderr, code } = await execOnHost(
    hostId,
    `docker logs --tail ${Number(tail) || 200} ${shellQuote(containerId)} 2>&1`
  );
  if (code !== 0 && !stdout) throw new Error(stderr || "Erreur Docker.");
  return stdout;
}

/** Tails a specific log file inside a running container (e.g. NPM's per-host access/error logs). */
export async function tailContainerFile(
  hostId: number,
  containerId: string,
  filePath: string,
  tail = 200
): Promise<string> {
  const { stdout, stderr, code } = await execOnHost(
    hostId,
    `docker exec ${shellQuote(containerId)} tail -n ${Number(tail) || 200} ${shellQuote(filePath)}`
  );
  if (code !== 0 && !stdout) throw new Error(stderr || "Erreur Docker.");
  return stdout;
}

type ContainerInspect = {
  Name: string;
  Config: { Image: string; Env: string[] | null; ExposedPorts: Record<string, unknown> | null };
  HostConfig: {
    Binds: string[] | null;
    PortBindings: Record<string, { HostPort: string }[]> | null;
    RestartPolicy: { Name: string };
    NetworkMode: string;
  };
};

/** Pulls the latest image and recreates the container with the same run configuration. */
export async function pullAndRecreate(hostId: number, containerId: string): Promise<string[]> {
  const log: string[] = [];

  const inspectRes = await execOnHost(hostId, `docker inspect ${shellQuote(containerId)}`);
  if (inspectRes.code !== 0) throw new Error(inspectRes.stderr || "Conteneur introuvable.");
  const [info] = JSON.parse(inspectRes.stdout) as ContainerInspect[];

  const image = info.Config.Image;
  const name = info.Name.replace(/^\//, "");

  log.push(`Pull de l'image ${image}...`);
  const pullRes = await execOnHost(hostId, `docker pull ${shellQuote(image)}`);
  log.push(pullRes.stdout.trim());
  if (pullRes.code !== 0) throw new Error(pullRes.stderr || "Échec du pull.");

  log.push(`Suppression du conteneur ${name}...`);
  const rmRes = await execOnHost(hostId, `docker rm -f ${shellQuote(containerId)}`);
  if (rmRes.code !== 0) throw new Error(rmRes.stderr || "Échec de la suppression.");

  const args = ["run", "-d", "--name", shellQuote(name)];
  if (info.HostConfig.RestartPolicy?.Name) {
    args.push("--restart", shellQuote(info.HostConfig.RestartPolicy.Name));
  }
  if (info.HostConfig.NetworkMode && info.HostConfig.NetworkMode !== "default") {
    args.push("--network", shellQuote(info.HostConfig.NetworkMode));
  }
  for (const bind of info.HostConfig.Binds ?? []) {
    args.push("-v", shellQuote(bind));
  }
  for (const [containerPort, bindings] of Object.entries(info.HostConfig.PortBindings ?? {})) {
    for (const binding of bindings ?? []) {
      args.push("-p", shellQuote(`${binding.HostPort}:${containerPort}`));
    }
  }
  for (const env of info.Config.Env ?? []) {
    args.push("-e", shellQuote(env));
  }
  args.push(shellQuote(image));

  const runCmd = `docker ${args.join(" ")}`;
  log.push(`Recréation: ${runCmd}`);
  const runRes = await execOnHost(hostId, runCmd);
  if (runRes.code !== 0) throw new Error(runRes.stderr || "Échec de la recréation.");
  log.push("Conteneur recréé avec succès.");

  return log;
}

export type NewContainerSpec = {
  image: string;
  name: string;
  ports: string[]; // "hostPort:containerPort"
  volumes: string[]; // "hostPath:containerPath"
  env: string[]; // "KEY=VALUE"
  restartPolicy: string;
};

export type ImageUpdateStatus = { containerId: string; name: string; image: string; updateAvailable: boolean };

/**
 * Pulls each running container's image fresh (grouped so a shared image is only pulled once)
 * and compares the resulting image ID against the one the container actually started from —
 * a `:latest`-style tag can't be compared to itself, so the "before" ID has to be captured from
 * the running container, not from the tag, before the pull overwrites what the tag points to.
 * Non-destructive: pulling never touches the running container, only a later recreate does.
 */
export async function checkForUpdates(hostId: number): Promise<ImageUpdateStatus[]> {
  const containers = (await listContainers(hostId)).filter((c) => c.state === "running");
  const byImage = new Map<string, DockerContainer[]>();
  for (const c of containers) {
    if (!byImage.has(c.image)) byImage.set(c.image, []);
    byImage.get(c.image)!.push(c);
  }

  const results: ImageUpdateStatus[] = [];
  for (const [image, group] of byImage) {
    try {
      const currentRes = await execOnHost(hostId, `docker inspect --format '{{.Image}}' ${shellQuote(group[0].id)}`);
      const currentId = currentRes.stdout.trim();

      const pullRes = await execOnHost(hostId, `docker pull ${shellQuote(image)}`);
      if (pullRes.code !== 0) throw new Error(pullRes.stderr || "Échec du pull.");

      const latestRes = await execOnHost(hostId, `docker inspect --format '{{.Id}}' ${shellQuote(image)}`);
      const latestId = latestRes.stdout.trim();

      const updateAvailable = !!currentId && !!latestId && currentId !== latestId;
      for (const c of group) results.push({ containerId: c.id, name: c.name, image, updateAvailable });
    } catch {
      for (const c of group) results.push({ containerId: c.id, name: c.name, image, updateAvailable: false });
    }
  }
  return results;
}

export async function runNewContainer(hostId: number, spec: NewContainerSpec): Promise<string> {
  const args = ["run", "-d"];
  if (spec.name) args.push("--name", shellQuote(spec.name));
  if (spec.restartPolicy) args.push("--restart", shellQuote(spec.restartPolicy));
  for (const p of spec.ports) if (p.trim()) args.push("-p", shellQuote(p.trim()));
  for (const v of spec.volumes) if (v.trim()) args.push("-v", shellQuote(v.trim()));
  for (const e of spec.env) if (e.trim()) args.push("-e", shellQuote(e.trim()));
  args.push(shellQuote(spec.image));

  const { stdout, stderr, code } = await execOnHost(hostId, `docker ${args.join(" ")}`);
  if (code !== 0) throw new Error(stderr || "Erreur Docker.");
  return stdout.trim();
}
