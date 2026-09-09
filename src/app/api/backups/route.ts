import { NextRequest, NextResponse } from "next/server";
import { createPlan, listPlans, type SourceType, type Schedule } from "@/lib/backup/plans";
import { getLatestRun } from "@/lib/backup/runs";
import { vaultEncrypt } from "@/lib/crypto";
import { logAudit } from "@/lib/db";

/** Strips anything sensitive out of a plan's source_config before it ever reaches the browser. */
function sanitizePlan(plan: ReturnType<typeof listPlans>[number]) {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(plan.sourceConfig);
  } catch {
    config = {};
  }
  let hasPassword: boolean | undefined;
  if (plan.sourceType === "database" && typeof config.passwordEncrypted === "string") {
    hasPassword = true;
    delete config.passwordEncrypted;
  }
  return { ...plan, sourceConfig: JSON.stringify(config), hasPassword };
}

export async function GET() {
  const plans = listPlans().map((plan) => ({ ...sanitizePlan(plan), latestRun: getLatestRun(plan.id) }));
  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    sourceHostId?: number;
    sourceType?: SourceType;
    sourceConfig?: Record<string, unknown>;
    password?: string;
    destHostId?: number;
    destPath?: string;
    schedule?: Schedule;
    retentionCount?: number;
  };

  if (!body.name || !body.sourceHostId || !body.sourceType || !body.destHostId || !body.destPath) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const config = { ...(body.sourceConfig || {}) };
  if (body.sourceType === "database") {
    if (!body.password) {
      return NextResponse.json({ error: "Mot de passe de la base de données requis." }, { status: 400 });
    }
    config.passwordEncrypted = vaultEncrypt(body.password);
  }

  const plan = createPlan({
    name: body.name,
    sourceHostId: body.sourceHostId,
    sourceType: body.sourceType,
    sourceConfig: JSON.stringify(config),
    destHostId: body.destHostId,
    destPath: body.destPath,
    schedule: body.schedule || "manual",
    retentionCount: body.retentionCount || 7,
    enabled: true,
  });

  logAudit("backup.plan_created", plan.id, plan.name);
  return NextResponse.json({ plan: sanitizePlan(plan) }, { status: 201 });
}
