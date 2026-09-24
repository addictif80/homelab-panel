import { NextRequest, NextResponse } from "next/server";
import { listMailEvents, listDistinctRecipients } from "@/lib/mail/mailIngest";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q")?.trim() || undefined;
  const recipient = req.nextUrl.searchParams.get("recipient")?.trim() || undefined;
  return NextResponse.json({
    events: listMailEvents(300, search, recipient),
    recipients: listDistinctRecipients(),
  });
}
