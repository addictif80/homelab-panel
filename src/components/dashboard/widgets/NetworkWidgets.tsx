"use client";

import { useEffect, useState } from "react";
import { MiniStat, WidgetError, WidgetLoading } from "../shared";

export function TailscaleWidget() {
  const [devices, setDevices] = useState<{ online: boolean }[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tailscale/devices")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setDevices(d.devices ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Tailscale non configuré."));
  }, []);

  if (error) return <WidgetError message={error} />;
  if (devices === null) return <WidgetLoading />;
  const online = devices.filter((d) => d.online).length;

  return <MiniStat value={`${online}/${devices.length}`} label="appareil(s) en ligne sur le tailnet" href="/tailscale" />;
}

export function PublicIpWidget() {
  const [ip, setIp] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/network/public-ip")
      .then((r) => r.json())
      .then((d) => setIp(d.ip ?? null))
      .catch(() => setIp(null));
  }, []);

  if (ip === undefined) return <WidgetLoading />;

  return <MiniStat value={ip ?? "—"} label="IP publique actuelle du panel" />;
}

type OutageSummary = { totalOutages: number; ongoing: boolean };

export function IspOutagesWidget() {
  const [summary, setSummary] = useState<OutageSummary | null>(null);

  useEffect(() => {
    fetch("/api/isp-outages")
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  if (!summary) return <WidgetLoading />;

  return (
    <MiniStat
      value={summary.ongoing ? "En cours" : String(summary.totalOutages)}
      label={summary.ongoing ? "coupure FAI en cours" : "coupure(s) FAI détectée(s) / 90j"}
      href="/routers"
    />
  );
}
