import { NextRequest, NextResponse } from "next/server";
import { deletePlan } from "@/lib/maintenance";
import { logAudit } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deletePlan(id);
  logAudit("maintenance.plan_delete", id);
  return NextResponse.json({ ok: true });
}
