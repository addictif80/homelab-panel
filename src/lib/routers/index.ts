import { getDb } from "../db";
import { vaultDecrypt, vaultEncrypt } from "../crypto";
import { createOpenWrtClient } from "./openwrt";
import { createPfSenseClient } from "./pfsense";
import { createFreeboxClient } from "./freebox";
import type { RouterProviderClient, RouterProviderId } from "./types";

export * from "./types";

type RouterConfig = { config: Record<string, string>; secret: Record<string, string> };

export function getRouterProvider(hostId: number): RouterProviderId | null {
  const row = getDb().prepare(`SELECT router_provider FROM hosts WHERE id = ?`).get(hostId) as
    | { router_provider: RouterProviderId | null }
    | undefined;
  return row?.router_provider ?? null;
}

export function setRouterProvider(hostId: number, provider: RouterProviderId | null): void {
  getDb().prepare(`UPDATE hosts SET router_provider = ? WHERE id = ?`).run(provider, hostId);
}

export function getRouterConfig(hostId: number): RouterConfig | null {
  const row = getDb()
    .prepare(`SELECT encrypted_data FROM credentials WHERE host_id = ? AND kind = 'api_token' AND label = 'router'`)
    .get(hostId) as { encrypted_data: string } | undefined;
  if (!row) return null;
  return JSON.parse(vaultDecrypt(row.encrypted_data));
}

export function setRouterConfig(hostId: number, config: Record<string, string>, secret: Record<string, string>): void {
  const db = getDb();
  db.prepare(`DELETE FROM credentials WHERE host_id = ? AND kind = 'api_token' AND label = 'router'`).run(hostId);
  db.prepare(`INSERT INTO credentials (host_id, kind, label, encrypted_data) VALUES (?, 'api_token', 'router', ?)`).run(
    hostId,
    vaultEncrypt(JSON.stringify({ config, secret }))
  );
}

export function getRouterClient(hostId: number): RouterProviderClient {
  const provider = getRouterProvider(hostId);
  if (!provider) throw new Error("Aucun fournisseur configuré pour cette machine.");

  if (provider === "openwrt") return createOpenWrtClient(hostId);

  const stored = getRouterConfig(hostId);
  if (!stored) throw new Error("Configuration manquante pour ce fournisseur.");

  switch (provider) {
    case "pfsense":
      return createPfSenseClient(stored.config, stored.secret);
    case "freebox":
      return createFreeboxClient(stored.config, stored.secret);
  }
}
