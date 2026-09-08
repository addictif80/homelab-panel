const MODULES = [
  { name: "Inventaire & topologie", status: "à venir" },
  { name: "Terminal SSH", status: "à venir" },
  { name: "Proxmox", status: "à venir" },
  { name: "Mises à jour", status: "à venir" },
  { name: "Explorateur de fichiers", status: "à venir" },
  { name: "Tailscale", status: "à venir" },
  { name: "Docker", status: "à venir" },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vue d&apos;ensemble</h1>
        <p className="text-sm text-neutral-400">
          Panneau de contrôle centralisé du homelab.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {MODULES.map((m) => (
          <div
            key={m.name}
            className="rounded border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="text-sm font-medium">{m.name}</div>
            <div className="mt-1 text-xs text-neutral-500">{m.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
