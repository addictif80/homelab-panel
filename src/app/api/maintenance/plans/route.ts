import { NextRequest, NextResponse } from "next/server";
import { listPlans, createPlan } from "@/lib/maintenance";
import { logAudit } from "@/lib/db";
import type { UpdateMode } from "@/lib/updates";

export async function GET() {
  return NextResponse.json({ plans: listPlans() });
}

export async function POST(req: NextRequest) {
  const { name, hostIds, mode, allowAutoReboot, delaySeconds } = (await req.json()) as {
    name?: string;
    hostIds?: number[];
    mode?: UpdateMode;
    allowAutoReboot?: boolean;
    delaySeconds?: number;
  };

  if (!name || !Array.isArray(hostIds) || hostIds.length === 0 || !mode) {
    return NextResponse.json({ error: "Nom, machines et mode requis." }, { status: 400 });
  }

  const plan = createPlan({
    name,
    hostIds: hostIds.map(Number),
    mode,
    allowAutoReboot: !!allowAutoReboot,
    delaySeconds: Number(delaySeconds) || 60,
  });
  logAudit("maintenance.plan_create", plan.id, name);
  return NextResponse.json({ plan });
}
