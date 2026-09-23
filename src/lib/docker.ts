import { runSshCommand, shellQuote } from "./ssh";

// Slightly under the 12s outer timeout callers (the fleet-wide containers route, monitoring)
// wrap this in — so the SSH connection is force-closed by the time the caller gives up, instead
// of lingering as an orphaned session on a host whose sudo/profile chain is already struggling.
const EXEC_TIMEOUT_MS = 11_000;

function execOnHost(hostId: number, rawCommand: string) {
  return runSshCommand(hostId, rawCommand, { sudo: true, timeoutMs: EXEC_TIMEOUT_MS });
}

// Some hosts print something before the actual command output on every SSH exec — a login
// banner, a PAM MOTD, a custom shell profile (seen in practice on CyberPanel-managed boxes, whose
// shell prints a banner starting with "This serve...", and others printing ASCII-art banners) —
// which corrupts JSON.parse() on the very first line. Prefixing the real command with a marker
// echo and discarding everything before it strips that noise regardless of what it is or where it
// comes from, without needing to special-case any particular panel or shell.
const OUTPUT_MARKER = "__HLP_DOCKER_OUTPUT__";

export async function execOnHostClean(hostId: number, rawCommand: string) {
  const result = await execOnHost(hostId, `echo ${OUTPUT_MARKER}; ${rawCommand}`);
  const idx = result.stdout.indexOf(OUTPUT_MARKER);
  const stdout = idx === -1 ? result.stdout : result.stdout.slice(idx + OUTPUT_MARKER.length).replace(/^\r?\n/, "");
  return { ...result, stdout };
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
  const { stdout, stderr, code } = await execOnHostClean(
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

export type ContainerIp = { name: string; ip: string };

/** Container name + internal Docker network IP for every running container on this host — used
 * to recognize a "suspicious" IP flagged in logs as actually being one of your own containers
 * (e.g. a reverse proxy's bridge IP showing up because X-Forwarded-For isn't configured), rather
 * than a real external address worth blocking. */
export async function listContainerIps(hostId: number): Promise<ContainerIp[]> {
  const { stdout, code } = await execOnHostClean(
    hostId,
    `docker ps -q | xargs -r docker inspect --format '{{.Name}}|{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null`
  );
  if (code !== 0) return [];

  return stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [namePart, ipsPart] = line.split("|");
      const name = (namePart ?? "").replace(/^\//, "");
      const ips = (ipsPart ?? "").trim().split(/\s+/).filter(Boolean);
      return ips.map((ip) => ({ name, ip }));
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

export type ContainerFileEntry = { name: string; type: "file" | "directory" };

const DIR_MARKER = "__HLP_DIRS__";
const FILE_MARKER = "__HLP_FILES__";

/** Lists one directory level *inside* a running container's own filesystem — for browsing to a
 * log file that lives only in the container (not on a host bind mount the SFTP-based file
 * explorer could otherwise reach). Deliberately avoids `find -printf` (a GNU findutils extension
 * many minimal images — Alpine/busybox in particular — don't have): `-exec ... basename {} \;` is
 * plain POSIX find, so this works the same on a Debian-based or an Alpine-based container image. */
export async function listContainerDirectory(hostId: number, containerId: string, path: string): Promise<ContainerFileEntry[]> {
  const target = path || "/";
  const script = [
    `echo ${DIR_MARKER}`,
    `find ${shellQuote(target)} -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; 2>/dev/null`,
    `echo ${FILE_MARKER}`,
    `find ${shellQuote(target)} -mindepth 1 -maxdepth 1 -type f -exec basename {} \\; 2>/dev/null`,
  ].join("\n");
  const { stdout, stderr, code } = await execOnHostClean(
    hostId,
    `docker exec ${shellQuote(containerId)} sh -c ${shellQuote(script)}`
  );
  if (code !== 0) throw new Error(stderr || "Impossible de parcourir ce dossier dans le conteneur.");

  const dirIdx = stdout.indexOf(DIR_MARKER);
  const fileIdx = stdout.indexOf(FILE_MARKER);
  const dirsBlock = dirIdx === -1 ? "" : stdout.slice(dirIdx + DIR_MARKER.length, fileIdx === -1 ? undefined : fileIdx);
  const filesBlock = fileIdx === -1 ? "" : stdout.slice(fileIdx + FILE_MARKER.length);

  const dirs = dirsBlock.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  const files = filesBlock.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  return [
    ...dirs.map((name) => ({ name, type: "directory" as const })),
    ...files.map((name) => ({ name, type: "file" as const })),
  ];
}

export type ContainerMount = { Type: "bind" | "volume" | string; Name?: string; Source: string; Destination: string };

export type ContainerInspect = {
  Name: string;
  Config: { Image: string; Env: string[] | null; ExposedPorts: Record<string, unknown> | null };
  HostConfig: {
    Binds: string[] | null;
    PortBindings: Record<string, { HostPort: string }[]> | null;
    RestartPolicy: { Name: string };
    NetworkMode: string;
  };
  Mounts: ContainerMount[];
};

export async function inspectContainer(hostId: number, containerId: string): Promise<ContainerInspect> {
  const inspectRes = await execOnHostClean(hostId, `docker inspect ${shellQuote(containerId)}`);
  if (inspectRes.code !== 0) throw new Error(inspectRes.stderr || "Conteneur introuvable.");
  const [info] = JSON.parse(inspectRes.stdout) as ContainerInspect[];
  return info;
}

/** Builds the `docker run` argument list to recreate a container from its own `docker inspect`
 * output — shared between recreating in place (pullAndRecreate) and recreating on a different
 * host after migrating its image and data there (dockerMigration.ts). Binds/named volumes are
 * carried over as the exact same strings Docker itself reported, since Docker's own `-v
 * name:/path` and `-v /host/path:/path` syntaxes are indistinguishable in HostConfig.Binds and
 * don't need to be told apart here — only migration's data-transfer step cares which is which. */
export function buildRunArgs(info: ContainerInspect, name: string, image: string): string[] {
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
  return args;
}

/** Pulls the latest image and recreates the container with the same run configuration. */
export async function pullAndRecreate(hostId: number, containerId: string): Promise<string[]> {
  const log: string[] = [];

  const info = await inspectContainer(hostId, containerId);
  const image = info.Config.Image;
  const name = info.Name.replace(/^\//, "");

  log.push(`Pull de l'image ${image}...`);
  const pullRes = await execOnHost(hostId, `docker pull ${shellQuote(image)}`);
  log.push(pullRes.stdout.trim());
  if (pullRes.code !== 0) throw new Error(pullRes.stderr || "Échec du pull.");

  log.push(`Suppression du conteneur ${name}...`);
  const rmRes = await execOnHost(hostId, `docker rm -f ${shellQuote(containerId)}`);
  if (rmRes.code !== 0) throw new Error(rmRes.stderr || "Échec de la suppression.");

  const runCmd = `docker ${buildRunArgs(info, name, image).join(" ")}`;
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
      const currentRes = await execOnHostClean(hostId, `docker inspect --format '{{.Image}}' ${shellQuote(group[0].id)}`);
      const currentId = currentRes.stdout.trim();

      const pullRes = await execOnHost(hostId, `docker pull ${shellQuote(image)}`);
      if (pullRes.code !== 0) throw new Error(pullRes.stderr || "Échec du pull.");

      const latestRes = await execOnHostClean(hostId, `docker inspect --format '{{.Id}}' ${shellQuote(image)}`);
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
