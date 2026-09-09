export default function StoreSuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-center text-neutral-100">
      <div>
        <h1 className="text-2xl font-semibold">Merci pour ton achat !</h1>
        <p className="mt-3 max-w-md text-sm text-neutral-400">
          Un email vient de t&apos;être envoyé avec ton lien de téléchargement (à usage unique, valable 7 jours).
          S&apos;il n&apos;arrive pas d&apos;ici quelques minutes, pense à vérifier tes spams.
        </p>
      </div>
    </div>
  );
}
