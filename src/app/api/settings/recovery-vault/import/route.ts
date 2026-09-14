import { NextRequest, NextResponse } from "next/server";
import { decryptSnapshot, restoreConfigSnapshot, type VaultEnvelope } from "@/lib/recoveryVault";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { passphrase, envelope } = (await req.json().catch(() => ({}))) as {
    passphrase?: string;
    envelope?: VaultEnvelope;
  };
  if (!passphrase) return NextResponse.json({ error: "Phrase secrète requise." }, { status: 400 });
  if (!envelope?.ciphertext) return NextResponse.json({ error: "Fichier de coffre-fort invalide." }, { status: 400 });

  let snapshot;
  try {
    snapshot = decryptSnapshot(passphrase, envelope);
  } catch {
    return NextResponse.json({ error: "Phrase secrète incorrecte ou fichier corrompu." }, { status: 400 });
  }

  const summary = restoreConfigSnapshot(snapshot);
  logAudit("settings.recovery_vault_imported", undefined, `${summary.reduce((n, s) => n + s.rows, 0)} lignes restaurées`);
  return NextResponse.json({ summary });
}
