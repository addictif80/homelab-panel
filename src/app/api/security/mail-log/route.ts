import { NextRequest, NextResponse } from "next/server";
import { listMailEvents } from "@/lib/mail/mailIngest";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q")?.trim() || undefined;
  return NextResponse.json({ events: listMailEvents(300, search) });
}
