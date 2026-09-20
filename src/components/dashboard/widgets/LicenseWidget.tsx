"use client";

import { useEffect, useState } from "react";
import { MiniStat, WidgetLoading } from "../shared";

type LicenseStatus = {
  activated: boolean;
  daysRemaining: number | null;
  expired: boolean;
};

export function LicenseWidget() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    fetch("/api/license/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (status === null) return <WidgetLoading />;

  if (status.activated) {
    return <MiniStat value="Activée" label="Licence du panel" tone="success" href="/settings" />;
  }

  return (
    <MiniStat
      value={status.expired ? "Expiré" : status.daysRemaining !== null ? `${status.daysRemaining} j` : "—"}
      label={status.expired ? "Essai terminé — active ta licence" : "restant(s) sur l'essai"}
      tone={status.expired ? "danger" : "warning"}
      href="/settings"
    />
  );
}
