export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
};

export type UpsertRecordInput = {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
};

export interface DnsProviderClient {
  listRecords(): Promise<DnsRecord[]>;
  createRecord(input: UpsertRecordInput): Promise<DnsRecord>;
  updateRecord(recordId: string, input: UpsertRecordInput): Promise<DnsRecord>;
  deleteRecord(recordId: string): Promise<void>;
}

export type DnsProviderType = "cloudflare" | "ovh" | "gandi" | "namecheap";

export type DnsProviderField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
};

export type DnsProviderMeta = {
  id: DnsProviderType;
  name: string;
  helpText: string;
  /** Public, non-secret fields — stored as-is in the zone's config. */
  configFields: DnsProviderField[];
  /** Sensitive fields — vault-encrypted, stored separately from config. */
  secretFields: DnsProviderField[];
};

export const DNS_PROVIDERS: DnsProviderMeta[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    helpText: "Crée un token API (My Profile → API Tokens) avec la permission « Zone.DNS: Edit » sur la zone.",
    configFields: [
      { key: "zoneId", label: "Zone ID" },
      { key: "zoneName", label: "Nom de domaine", placeholder: "exemple.fr" },
    ],
    secretFields: [{ key: "apiToken", label: "Token API", secret: true }],
  },
  {
    id: "ovh",
    name: "OVH",
    helpText:
      "Crée une application sur https://api.ovh.com/createApp puis un consumer key autorisé sur /domain/zone/*/** " +
      "via https://api.ovh.com/createToken (endpoint ovh-eu pour la France).",
    configFields: [
      { key: "zoneName", label: "Nom de domaine", placeholder: "exemple.fr" },
      { key: "endpoint", label: "Endpoint OVH", placeholder: "ovh-eu" },
    ],
    secretFields: [
      { key: "applicationKey", label: "Application Key", secret: true },
      { key: "applicationSecret", label: "Application Secret", secret: true },
      { key: "consumerKey", label: "Consumer Key", secret: true },
    ],
  },
  {
    id: "gandi",
    name: "Gandi",
    helpText: "Crée une clé d'API personnelle (Personal Access Token) depuis le compte Gandi, avec les droits LiveDNS.",
    configFields: [{ key: "domain", label: "Nom de domaine", placeholder: "exemple.fr" }],
    secretFields: [{ key: "apiToken", label: "Token API", secret: true }],
  },
  {
    id: "namecheap",
    name: "Namecheap",
    helpText:
      "Active l'accès API dans le compte Namecheap et whiteliste l'IP publique de ce serveur — Namecheap ne gère " +
      "les enregistrements que par remplacement complet de la liste, une opération est donc un peu plus lente.",
    configFields: [
      { key: "sld", label: "Domaine (SLD)", placeholder: "exemple" },
      { key: "tld", label: "Extension (TLD)", placeholder: "fr" },
      { key: "apiUser", label: "ApiUser" },
      { key: "username", label: "Username" },
      { key: "clientIp", label: "IP whitelistée", placeholder: "203.0.113.10" },
    ],
    secretFields: [{ key: "apiKey", label: "Clé API", secret: true }],
  },
];
