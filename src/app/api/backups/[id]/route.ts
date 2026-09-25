import { NextRequest, NextResponse } from "next/server";
import { deletePlan, getPlan, updatePlan, type Schedule } from "@/lib/backup/plans";
import { vaultEncrypt } from "@/lib/crypto";
import { logAudit } from "@/lib/db";

const AT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan introuvable." }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    destHostId?: number;
    destPath?: string;
    schedule?: Schedule;
    atTime?: string | null;
    retentionCount?: number;
    enabled?: boolean;
    sourceConfig?: Record<string, unknown>;
    password?: string;
  };

  if (body.atTime && !AT_TIME_RE.test(body.atTime)) {
    return NextResponse.json({ error: "Heure planifiée invalide (format attendu : HH:MM)." }, { status: 400 });
  }

  let sourceConfig: string | undefined;
  if (body.sourceConfig) {
    const config = { ...body.sourceConfig };
    if (plan.sourceType === "database") {
      const current = JSON.parse(plan.sourceConfig);
      config.passwordEncrypted = body.password ? vaultEncrypt(body.password) : current.passwordEncrypted;
    }
    sourceConfig = JSON.stringify(config);
  }

  updatePlan(id, {
    name: body.name,
    destHostId: body.destHostId,
    destPath: body.destPath,
    schedule: body.schedule,
    atTime: body.atTime === undefined ? undefined : body.atTime?.trim() || null,
    retentionCount: body.retentionCount,
    enabled: body.enabled,
    sourceConfig,
  });

  logAudit("backup.plan_updated", id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deletePlan(id);
  logAudit("backup.plan_deleted", id);
  return NextResponse.json({ ok: true });
}
