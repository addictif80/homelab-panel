import { NextResponse } from "next/server";
import { listTickets } from "@/lib/seller/supportTickets";

export async function GET() {
  return NextResponse.json({ tickets: listTickets() });
}
