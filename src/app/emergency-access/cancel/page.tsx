"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function CancelPage() {
  return (
    <Suspense fallback={null}>
      <CancelForm />
    </Suspense>
  );
}

function CancelForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Jeton manquant.");
      return;
    }
    fetch(`/api/emergency-access/cancel?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setStatus("ok");
        } else {
          setStatus("error");
          setMessage(d.error || "Erreur.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Erreur réseau.");
      });
  }, [token]);

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-950 p-6">
      <div className="card w-full max-w-sm p-8 text-center">
        <h1 className="font-display text-lg font-bold text-neutral-100 mb-3">Annulation de l&apos;accès d&apos;urgence</h1>
        {status === "loading" && <p className="text-sm text-neutral-500">Vérification…</p>}
        {status === "ok" && (
          <p className="text-sm text-emerald-400">
            La demande d&apos;accès d&apos;urgence a bien été annulée. Ton compte n&apos;est pas concerné.
          </p>
        )}
        {status === "error" && <p className="text-sm text-red-400">{message}</p>}
      </div>
    </main>
  );
}
