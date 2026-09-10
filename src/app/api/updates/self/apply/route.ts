import { NextResponse } from "next/server";
import { checkForUpdate, startSelfUpdateJob } from "@/lib/selfUpdate";
import { logAudit } from "@/lib/db";

export async function POST() {
  const check = await checkForUpdate();
  if (!check.updateAvailable || !check.latestVersion) {
    return NextResponse.json({ error: "Aucune mise à jour disponible." }, { status: 400 });
  }

  const jobId = startSelfUpdateJob(check.latestVersion);
  logAudit("panel.self_update_start", check.latestVersion, check.currentVersion);
  return NextResponse.json({ jobId }, { status: 202 });
}
