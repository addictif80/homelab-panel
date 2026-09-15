import { NextRequest, NextResponse } from "next/server";
import { getDirectoryOwnerName, setDirectoryOwnerName } from "@/lib/directorySubmission";

export async function GET() {
  return NextResponse.json({ ownerName: getDirectoryOwnerName() });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  if (!ownerName) return NextResponse.json({ error: "Nom requis." }, { status: 400 });
  setDirectoryOwnerName(ownerName);
  return NextResponse.json({ ok: true });
}
