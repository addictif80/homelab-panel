import { getSetting, setSetting } from "./db";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

const CONFIG_KEY = "npm_config";
const PASSWORD_KEY = "npm_password_encrypted";

export type NpmConfig = { baseUrl: string; email: string };

export function getNpmConfig(): NpmConfig | null {
  const raw = getSetting(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function hasNpmPassword(): boolean {
  return !!getSetting(PASSWORD_KEY);
}

export function setNpmConfig(config: NpmConfig, password?: string): void {
  setSetting(CONFIG_KEY, JSON.stringify(config));
  if (password) setSetting(PASSWORD_KEY, vaultEncrypt(password));
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const config = getNpmConfig();
  const encryptedPassword = getSetting(PASSWORD_KEY);
  if (!config || !encryptedPassword) throw new Error("Nginx Proxy Manager n'est pas configuré.");

  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: config.email, secret: vaultDecrypt(encryptedPassword) }),
  });
  if (!res.ok) throw new Error(`Connexion à NPM échouée (${res.status}).`);
  const data = (await res.json()) as { token: string; expires: string };
  cachedToken = { token: data.token, expiresAt: new Date(data.expires).getTime() };
  return data.token;
}

async function npmFetch(path: string, options: RequestInit = {}) {
  const config = getNpmConfig();
  if (!config) throw new Error("Nginx Proxy Manager n'est pas configuré.");
  const token = await getToken();

  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NPM API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type ProxyHost = {
  id: number;
  domainNames: string[];
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
  sslForced: boolean;
  enabled: boolean;
  certificateId: number | null;
};

type RawProxyHost = {
  id: number;
  domain_names: string[];
  forward_scheme: "http" | "https";
  forward_host: string;
  forward_port: number;
  ssl_forced: number;
  enabled: number;
  certificate_id: number | null;
};

function fromRaw(raw: RawProxyHost): ProxyHost {
  return {
    id: raw.id,
    domainNames: raw.domain_names,
    forwardScheme: raw.forward_scheme,
    forwardHost: raw.forward_host,
    forwardPort: raw.forward_port,
    sslForced: !!raw.ssl_forced,
    enabled: !!raw.enabled,
    certificateId: raw.certificate_id,
  };
}

export async function listProxyHosts(): Promise<ProxyHost[]> {
  const data = (await npmFetch("/api/nginx/proxy-hosts")) as RawProxyHost[];
  return data.map(fromRaw);
}

export type ProxyHostInput = {
  domainNames: string[];
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
  sslForced?: boolean;
};

function toRawBody(input: ProxyHostInput) {
  return {
    domain_names: input.domainNames,
    forward_scheme: input.forwardScheme,
    forward_host: input.forwardHost,
    forward_port: input.forwardPort,
    ssl_forced: input.sslForced ? 1 : 0,
    block_exploits: true,
    allow_websocket_upgrade: true,
    caching_enabled: false,
    access_list_id: "0",
    certificate_id: 0,
    meta: {},
    advanced_config: "",
  };
}

export async function createProxyHost(input: ProxyHostInput): Promise<ProxyHost> {
  const raw = (await npmFetch("/api/nginx/proxy-hosts", {
    method: "POST",
    body: JSON.stringify(toRawBody(input)),
  })) as RawProxyHost;
  return fromRaw(raw);
}

export async function updateProxyHost(id: number, input: ProxyHostInput): Promise<ProxyHost> {
  const raw = (await npmFetch(`/api/nginx/proxy-hosts/${id}`, {
    method: "PUT",
    body: JSON.stringify(toRawBody(input)),
  })) as RawProxyHost;
  return fromRaw(raw);
}

export async function deleteProxyHost(id: number): Promise<void> {
  await npmFetch(`/api/nginx/proxy-hosts/${id}`, { method: "DELETE" });
}

export async function setProxyHostEnabled(id: number, enabled: boolean): Promise<void> {
  await npmFetch(`/api/nginx/proxy-hosts/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" });
}
