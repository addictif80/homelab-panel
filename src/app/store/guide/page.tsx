import Link from "next/link";

const LOGOMARK = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" className="text-blue-600" />
    <path d="M7.5 9H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 12.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
  </svg>
);

const STEPS = [
  {
    title: "1. Prérequis",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Un serveur (VPS, mini-PC, Proxmox/LXC...) accessible en SSH, avec Node.js 20+ installé.</li>
        <li>Un nom de domaine pointant vers ce serveur (recommandé pour le HTTPS et Stripe/emails).</li>
        <li>Un reverse proxy pour le HTTPS : Nginx Proxy Manager, Caddy, Traefik ou Nginx classique.</li>
      </ul>
    ),
  },
  {
    title: "2. Réception et extraction",
    body: (
      <p>
        Après ton achat, un email t&apos;envoie un lien de téléchargement à usage unique (valable 7 jours) contenant
        une archive <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs">.zip</code>. Transfère-la
        sur ton serveur (SCP, SFTP...) puis extrais-la :
        <code className="mt-2 block rounded bg-neutral-900 p-3 font-mono text-xs">
          unzip homelab-panel.zip -d homelab-panel && cd homelab-panel
        </code>
      </p>
    ),
  },
  {
    title: "3. Installation",
    body: (
      <p>
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-xs">npm install</code> puis{" "}
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-xs">npm run build</code>. Ta clé
        d&apos;activation est déjà intégrée à l&apos;archive — le panel s&apos;active tout seul au premier démarrage,
        rien à saisir.
      </p>
    ),
  },
  {
    title: "4. Démarrage",
    body: (
      <p>
        Lance <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-xs">npm start</code> pour tester,
        puis configure un service systemd (ou PM2) pour qu&apos;il redémarre automatiquement avec le serveur :
        <code className="mt-2 block whitespace-pre-wrap rounded bg-neutral-900 p-3 font-mono text-xs">
{`[Unit]
Description=Homelab Panel
After=network.target

[Service]
WorkingDirectory=/chemin/vers/homelab-panel
ExecStart=/usr/bin/npm start
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target`}
        </code>
      </p>
    ),
  },
  {
    title: "5. Reverse proxy et HTTPS",
    body: (
      <p>
        Pointe ton domaine vers le port du panel (par défaut 3000) via ton reverse proxy, avec un certificat HTTPS
        (Let&apos;s Encrypt automatique sur Nginx Proxy Manager/Caddy). Le panel détecte et affiche correctement son
        URL publique une fois configurée dans son propre onglet Réglages.
      </p>
    ),
  },
  {
    title: "6. Première connexion",
    body: (
      <p>
        Ouvre ton domaine, crée ton compte administrateur et active la double authentification (2FA) — obligatoire
        au premier lancement. Ajoute ensuite tes serveurs (SSH), et c&apos;est prêt.
      </p>
    ),
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6">
          <Link href="/store" className="flex items-center gap-2.5">
            {LOGOMARK}
            <span className="font-display text-base font-semibold">Homelab Panel</span>
          </Link>
          <Link href="/store" className="text-sm text-neutral-400 hover:text-neutral-100">
            ← Retour à la page de vente
          </Link>
        </div>
      </nav>

      <header className="border-b border-neutral-800 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Guide de déploiement</span>
          <h1 className="mt-3 text-3xl font-semibold">De l&apos;achat au panel en ligne, étape par étape</h1>
          <p className="mt-3 text-neutral-400">
            Compte environ 15 minutes si ton serveur et ton domaine sont déjà prêts. Besoin d&apos;aide ?{" "}
            <Link href="/store#support" className="text-blue-400 hover:underline">
              Ouvre un ticket d&apos;assistance
            </Link>
            .
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-14">
        {STEPS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold text-neutral-100">{s.title}</h2>
            <div className="mt-3 text-sm leading-relaxed text-neutral-400">{s.body}</div>
          </section>
        ))}
      </main>

      <footer className="border-t border-neutral-800 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 text-sm text-neutral-500">
          <span>Homelab Panel</span>
          <Link href="/store#support" className="hover:text-neutral-300">
            Besoin d&apos;aide ?
          </Link>
        </div>
      </footer>
    </div>
  );
}
