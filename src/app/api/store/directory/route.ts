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
    description: s.description,
    faviconDataUrl: s.faviconDataUrl,
    screenshotDataUrl: s.screenshotDataUrl,
  }));
  return NextResponse.json({ entries });
}
