import { NextResponse } from "next/server";
import { listBlockedSenders } from "@/lib/mail/senderBlock";

export async function GET() {
  return NextResponse.json({ blockedSenders: listBlockedSenders() });
}
