import { NextResponse } from "next/server";
import { listPackages } from "@/lib/cyberpanel";

export async function GET() {
  try {
    const packages = await listPackages();
    return NextResponse.json({ packages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 502 });
  }
}
