export default function HelpUrgencePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Aide — Accès d&apos;urgence</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Tu as reçu cet accès parce que la personne qui gère ce serveur t&apos;a désigné(e) comme contact de confiance.
          Cette page explique, sans connaissances techniques, ce que c&apos;est et quoi faire en premier.
        </p>
      </div>

      <section className="space-y-2 rounded border border-neutral-800 p-4">
        <h2 className="font-semibold text-neutral-100">C&apos;est quoi, ce panel ?</h2>
        <p className="text-sm text-neutral-400">
          C&apos;est un tableau de bord qui gère l&apos;ensemble des serveurs, sauvegardes et services de la personne qui
          t&apos;a désigné(e). Tu as maintenant les mêmes droits qu&apos;elle : tu peux tout consulter et, si besoin,
          agir dessus (relancer un service, restaurer une sauvegarde, contacter un prestataire, etc.).
        </p>
      </section>

      <section className="space-y-2 rounded border border-neutral-800 p-4">
        <h2 className="font-semibold text-neutral-100">Par où commencer ?</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-400">
          <li>
            Va dans <a href="/" className="text-blue-400 hover:underline">Vue d&apos;ensemble</a> pour voir en un
            coup d&apos;œil si tout fonctionne normalement.
          </li>
          <li>
            Va dans <a href="/architecture" className="text-blue-400 hover:underline">Documentation d&apos;architecture</a>{" "}
            : c&apos;est un document généré automatiquement qui explique tout ce qui existe (serveurs, services,
            sauvegardes) — le meilleur point de départ pour comprendre l&apos;installation.
          </li>
          <li>
            Va dans <a href="/backups" className="text-blue-400 hover:underline">Sauvegardes</a> pour voir si les
            données sont bien protégées.
          </li>
          <li>
            Si quelque chose semble cassé, le{" "}
            <a href="/disaster-simulator" className="text-blue-400 hover:underline">Simulateur de sinistre</a> et le{" "}
            <a href="/incidents" className="text-blue-400 hover:underline">journal des incidents</a> t&apos;aideront
            à comprendre ce qui s&apos;est passé et ce qu&apos;il faut faire.
          </li>
        </ol>
      </section>

      <section className="space-y-2 rounded border border-neutral-800 p-4">
        <h2 className="font-semibold text-neutral-100">Le compte d&apos;origine</h2>
        <p className="text-sm text-neutral-400">
          Pour des raisons de sécurité, l&apos;ancien compte administrateur a été automatiquement suspendu lors de ton
          activation. Si la situation se résout (la personne réapparaît, l&apos;alerte était une erreur), va dans{" "}
          <a href="/users" className="text-blue-400 hover:underline">Comptes</a> et clique sur{" "}
          <strong>Débloquer</strong> à côté de son nom — c&apos;est la seule façon de le réactiver, et toi seul(e) peux
          le faire.
        </p>
      </section>

      <section className="space-y-2 rounded border border-neutral-800 p-4">
        <h2 className="font-semibold text-neutral-100">Besoin d&apos;aide technique ?</h2>
        <p className="text-sm text-neutral-400">
          Ce panel est conçu pour être utilisable sans connaissances techniques poussées : chaque section a un titre
          clair et affiche l&apos;état actuel en langage simple. Si une action te semble risquée ou que tu ne
          comprends pas une situation, il vaut mieux ne rien changer et demander de l&apos;aide à quelqu&apos;un de
          confiance plutôt que d&apos;improviser.
        </p>
      </section>
    </div>
  );
}
