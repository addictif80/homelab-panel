export type AppTemplate = {
  id: string;
  name: string;
  description: string;
  image: string;
  ports: string[];
  volumes: string[];
  env: string[];
  restartPolicy: string;
};

/** A small curated set of common self-hosted apps — one-click prefill for the "run a container"
 * form on /docker, not a full app-store. Volumes use relative paths under the app's own name so
 * multiple templates never collide by default; the user can edit before launching. */
export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: "portainer",
    name: "Portainer",
    description: "Interface de gestion Docker complète, en complément de ce panel.",
    image: "portainer/portainer-ce:latest",
    ports: ["9000:9000"],
    volumes: ["/var/run/docker.sock:/var/run/docker.sock", "./portainer/data:/data"],
    env: [],
    restartPolicy: "unless-stopped",
  },
  {
    id: "pihole",
    name: "Pi-hole",
    description: "Bloqueur de publicités DNS pour tout le réseau local.",
    image: "pihole/pihole:latest",
    ports: ["53:53/tcp", "53:53/udp", "8081:80"],
    volumes: ["./pihole/etc-pihole:/etc/pihole", "./pihole/etc-dnsmasq.d:/etc/dnsmasq.d"],
    env: ["TZ=Europe/Paris", "WEBPASSWORD=changeme"],
    restartPolicy: "unless-stopped",
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description: "Serveur Bitwarden léger et auto-hébergé pour la gestion de mots de passe.",
    image: "vaultwarden/server:latest",
    ports: ["8082:80"],
    volumes: ["./vaultwarden/data:/data"],
    env: ["SIGNUPS_ALLOWED=false"],
    restartPolicy: "unless-stopped",
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Supervision de disponibilité (uptime) avec belles pages de statut.",
    image: "louislam/uptime-kuma:latest",
    ports: ["3001:3001"],
    volumes: ["./uptime-kuma/data:/app/data"],
    env: [],
    restartPolicy: "unless-stopped",
  },
  {
    id: "adminer",
    name: "Adminer",
    description: "Client web léger pour administrer des bases MySQL/PostgreSQL/SQLite.",
    image: "adminer:latest",
    ports: ["8083:8080"],
    volumes: [],
    env: [],
    restartPolicy: "unless-stopped",
  },
  {
    id: "watchtower",
    name: "Watchtower",
    description: "Met automatiquement à jour les images des autres conteneurs sur cette machine.",
    image: "containrrr/watchtower:latest",
    ports: [],
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
    env: [],
    restartPolicy: "unless-stopped",
  },
  {
    id: "homepage",
    name: "Homepage",
    description: "Tableau de bord d'accueil listant tous tes services auto-hébergés.",
    image: "ghcr.io/gethomepage/homepage:latest",
    ports: ["3003:3000"],
    volumes: ["./homepage/config:/app/config"],
    env: [],
    restartPolicy: "unless-stopped",
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Automatisation de workflows (façon Zapier), auto-hébergée.",
    image: "n8nio/n8n:latest",
    ports: ["5678:5678"],
    volumes: ["./n8n/data:/home/node/.n8n"],
    env: ["TZ=Europe/Paris"],
    restartPolicy: "unless-stopped",
  },
];
