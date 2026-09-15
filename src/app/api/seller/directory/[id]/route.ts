import { NextRequest, NextResponse } from "next/server";
import { deleteDirectorySubmission, reviewDirectorySubmission } from "@/lib/seller/directory";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: "approved" | "rejected" };
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "Statut invalide." }, { status: 400 });
  }
  const submission = reviewDirectorySubmission(id, status);
  if (!submission) return NextResponse.json({ error: "Soumission introuvable." }, { status: 404 });
  logAudit("seller.directory_reviewed", id, status);
  return NextResponse.json({ submission });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteDirectorySubmission(id);
  logAudit("seller.directory_deleted", id);
  return NextResponse.json({ ok: true });
}
