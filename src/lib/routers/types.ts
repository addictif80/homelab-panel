export type RouterStatus = {
  model: string | null;
  uptimeSeconds: number | null;
  wanIp: string | null;
  connectedDevicesCount: number | null;
};

export type ConnectedDevice = {
  id: string;
  hostname: string | null;
  ip: string;
  mac: string;
  wifi: boolean;
};

export type PortForward = {
  id: string;
  protocol: "tcp" | "udp" | "both";
  externalPort: string;
  internalIp: string;
  internalPort: string;
  description?: string;
  enabled: boolean;
};

export type PortForwardInput = Omit<PortForward, "id">;

export type WifiNetwork = {
  id: string;
  band: "2.4GHz" | "5GHz" | "6GHz" | string;
  ssid: string;
  enabled: boolean;
};

export interface RouterProviderClient {
  getStatus(): Promise<RouterStatus>;
  listDevices(): Promise<ConnectedDevice[]>;
  listPortForwards(): Promise<PortForward[]>;
  createPortForward(input: PortForwardInput): Promise<PortForward>;
  deletePortForward(id: string): Promise<void>;
  listWifiNetworks(): Promise<WifiNetwork[]>;
  setWifiEnabled(id: string, enabled: boolean): Promise<void>;
  reboot(): Promise<void>;
}

export type RouterProviderId = "openwrt" | "pfsense" | "freebox";

export type RouterProviderField = { key: string; label: string; placeholder?: string; secret?: boolean };

export type RouterProviderMeta = {
  id: RouterProviderId;
  name: string;
  helpText: string;
  /** OpenWrt reuses the host's own SSH credentials already in the inventory — nothing more to
   * configure, unlike pfSense/Freebox which need their own API config. */
  needsConfig: boolean;
  configFields: RouterProviderField[];
  secretFields: RouterProviderField[];
};

export const ROUTER_PROVIDERS: RouterProviderMeta[] = [
  {
    id: "openwrt",
    name: "OpenWrt",
    helpText: "Utilise les identifiants SSH déjà renseignés pour cette machine dans l'inventaire — rien d'autre à configurer.",
    needsConfig: false,
    configFields: [],
    secretFields: [],
  },
  {
    id: "pfsense",
    name: "pfSense",
    helpText:
      "Active l'API REST de pfSense (System → REST API sur pfSense 2.5+, ou installe le package pfSense-pkg-API) et crée une clé.",
    needsConfig: true,
    configFields: [{ key: "baseUrl", label: "URL de pfSense", placeholder: "https://192.168.1.1" }],
    secretFields: [
      { key: "apiKey", label: "Clé API", secret: true },
      { key: "apiSecret", label: "Secret API (si requis)", secret: true },
    ],
  },
  {
    id: "freebox",
    name: "Freebox",
    helpText:
      "Nécessite un appairage : le panel demande un accès, et il faut valider sur l'écran physique de la Freebox dans les 30 secondes.",
    needsConfig: true,
    configFields: [{ key: "baseUrl", label: "URL de l'API Freebox", placeholder: "https://mafreebox.freebox.fr" }],
    secretFields: [],
  },
];
