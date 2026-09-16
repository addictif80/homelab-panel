import { NextResponse } from "next/server";
import { listCertificates } from "@/lib/npm";

export async function GET() {
  try {
    const certificates = await listCertificates();
    return NextResponse.json({ certificates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
