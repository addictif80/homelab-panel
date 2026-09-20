"use client";

import { useEffect, useState } from "react";
import { MiniStat, WidgetLoading } from "../shared";

type Container = { id: string; state: string; hostId: number };
type DockerHostEntry = { hostId: number; hostName: string; error: string | null };

export function DockerWidget() {
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [hosts, setHosts] = useState<DockerHostEntry[]>([]);

  useEffect(() => {
    fetch("/api/docker/containers")
      .then((r) => r.json())
      .then((d) => {
        setContainers(d.containers ?? []);
        setHosts(d.hosts ?? []);
      })
      .catch(() => setContainers([]));
  }, []);

  if (containers === null) return <WidgetLoading />;
  const running = containers.filter((c) => c.state === "running").length;
  const okHosts = hosts.filter((h) => !h.error).length;

  return (
    <MiniStat
      value={`${running}/${containers.length}`}
      label={`conteneurs actifs sur ${okHosts}/${hosts.length} hôte(s) Docker`}
      href="/docker"
    />
  );
}

type Host = { id: number; kind: string; proxmox_node: string | null };

export function ProxmoxWidget() {
  const [hosts, setHosts] = useState<Host[] | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts ?? []))
      .catch(() => setHosts([]));
  }, []);

  if (hosts === null) return <WidgetLoading />;
  const nodes = hosts.filter((h) => h.proxmox_node);

  return <MiniStat value={String(nodes.length)} label="nœud(s) Proxmox connu(s)" href="/proxmox" />;
}

export function UpdatesWidget() {
  const [hosts, setHosts] = useState<{ update_method: string | null }[] | null>(null);

  useEffect(() => {
    fetch("/api/hosts")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts ?? []))
      .catch(() => setHosts([]));
  }, []);

  if (hosts === null) return <WidgetLoading />;
  const configured = hosts.filter((h) => h.update_method).length;

  return <MiniStat value={`${configured}/${hosts.length}`} label="machines avec mises à jour configurées" href="/updates" />;
}
