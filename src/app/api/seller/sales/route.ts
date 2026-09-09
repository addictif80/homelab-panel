import { NextResponse } from "next/server";
import { listSales } from "@/lib/seller/sales";

export async function GET() {
  const sales = listSales();
  const totalCents = sales.reduce((sum, s) => sum + s.amountCents, 0);
  return NextResponse.json({ sales, totalCents });
}
