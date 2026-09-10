import https from "https";
import { createHash } from "crypto";
import { getSetting, setSetting } from "./db";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

const CONFIG_KEY = "cyberpanel_config";
const PASSWORD_KEY = "cyberpanel_password_encrypted";

export type CyberPanelConfig = { baseUrl: string; adminUser: string; verifySsl?: boolean };

export function getCyberPanelConfig(): CyberPanelConfig | null {
  const raw = getSetting(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function hasCyberPanelPassword(): boolean {
  return !!getSetting(PASSWORD_KEY);
}

export function setCyberPanelConfig(config: CyberPanelConfig, password?: string): void {
  setSetting(CONFIG_KEY, JSON.stringify(config));
  if (password) setSetting(PASSWORD_KEY, vaultEncrypt(password));
}

/** CyberPanel's cloudAPI takes a static "Basic <sha256(user:password)>" token rather than a
 * real session — same scheme as its own admin UI uses for API calls. */
function authHeader(config: CyberPanelConfig): string {
  const encrypted = getSetting(PASSWORD_KEY);
  if (!encrypted) throw new Error("CyberPanel n'est pas configuré.");
  const password = vaultDecrypt(encrypted);
  return `Basic ${createHash("sha256").update(`${config.adminUser}:${password}`).digest("hex")}`;
}

/**
 * CyberPanel's admin UI (and its cloudAPI) runs behind a self-signed TLS certificate by
 * default — Node's global `fetch` rejects that outright (surfaces as an opaque "fetch failed",
 * before any HTTP response even comes back), so this uses `https.request` directly instead,
 * the same way lib/proxmox.ts already does for the same reason.
 */
function cyberPanelRequest(controller: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const config = getCyberPanelConfig();
  if (!config) throw new Error("CyberPanel n'est pas configuré.");

  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/cloudAPI/`);
  const payload = JSON.stringify({ serverUserName: config.adminUser, controller, ...data });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        rejectUnauthorized: config.verifySsl ?? false,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: authHeader(config),
        },
        timeout: 15_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`CyberPanel a répondu ${res.statusCode}: ${raw || res.statusMessage}`));
            return;
          }
          let result: Record<string, unknown>;
          try {
            result = JSON.parse(raw);
          } catch {
            reject(new Error("Réponse CyberPanel invalide."));
            return;
          }
          if (result.status === 0) {
            reject(new Error(`CyberPanel : ${result.error_message || "Erreur inconnue."}`));
            return;
          }
          resolve(result);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timeout de connexion à CyberPanel.")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parseDataField(result: Record<string, unknown>): unknown[] {
  const raw = result.data;
  const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  return Array.isArray(parsed) ? parsed : [];
}

export type CyberPanelWebsite = { domain: string; adminEmail?: string; state?: string; package?: string };

export async function listWebsites(): Promise<CyberPanelWebsite[]> {
  const result = await cyberPanelRequest("fetchWebsites", { page: 1 });
  return (parseDataField(result) as Record<string, unknown>[])
    .filter((w) => typeof w.domain === "string")
    .map((w) => ({
      domain: w.domain as string,
      adminEmail: w.adminEmail as string | undefined,
      state: w.state as string | undefined,
      package: w.package as string | undefined,
    }));
}

export async function createWebsite(input: {
  domain: string;
  username: string;
  password: string;
  email: string;
  packageName?: string;
}): Promise<void> {
  await cyberPanelRequest("submitWebsiteCreation", {
    domainName: input.domain,
    ownerEmail: input.email,
    adminEmail: input.email,
    websiteOwner: input.username,
    package: input.packageName || "Default",
    UserAccountName: input.username,
    UserPassword: input.password,
    FullName: input.username,
    websitesLimit: 0,
  });
}

export async function deleteWebsite(domain: string): Promise<void> {
  await cyberPanelRequest("submitWebsiteDeletion", { domainName: domain });
}

export async function listPackages(): Promise<string[]> {
  const result = await cyberPanelRequest("fetchPackages");
  return (parseDataField(result) as Record<string, unknown>[])
    .filter((p) => typeof p.packageName === "string")
    .map((p) => p.packageName as string);
}

export async function testCyberPanelConnection(): Promise<void> {
  await cyberPanelRequest("fetchWebsites", { page: 1 });
}
