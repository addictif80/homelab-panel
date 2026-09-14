import { NextRequest, NextResponse } from "next/server";
import { buildConfigSnapshot, encryptSnapshot } from "@/lib/recoveryVault";
import { logAudit } from "@/lib/db";

const MIN_PASSPHRASE_LENGTH = 12;

export async function POST(req: NextRequest) {
  const { passphrase } = (await req.json().catch(() => ({}))) as { passphrase?: string };
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return NextResponse.json(
      { error: `La phrase secrète doit faire au moins ${MIN_PASSPHRASE_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  const snapshot = buildConfigSnapshot();
  const envelope = encryptSnapshot(passphrase, snapshot);
  logAudit("settings.recovery_vault_exported");

  const filename = `homelab-panel-vault-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(envelope, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
