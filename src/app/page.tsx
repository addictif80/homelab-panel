const MODULES = [
  { name: "Serveurs physiques", status: "disponible" },
  { name: "Serveurs VM", status: "disponible" },
  { name: "Docker", status: "disponible" },
  { name: "Terminal SSH", status: "disponible" },
  { name: "Mises à jour", status: "disponible" },
  { name: "Explorateur de fichiers", status: "disponible" },
  { name: "Tailscale", status: "disponible" },
  { name: "Inventaire & topologie", status: "disponible" },
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
