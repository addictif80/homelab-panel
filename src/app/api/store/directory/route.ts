import { NextResponse } from "next/server";
import { listApprovedDirectoryEntries } from "@/lib/seller/directory";

/** Public, unauthenticated: feeds the "Annuaire" section on /store. Only admin-approved entries,
 * and only the fields a visitor needs. */
export async function GET() {
  const entries = listApprovedDirectoryEntries().map((s) => ({
    id: s.id,
    ownerName: s.ownerName,
    serviceName: s.serviceName,
    serviceUrl: s.serviceUrl,
    faviconDataUrl: s.faviconDataUrl,
  }));
  return NextResponse.json({ entries });
}
