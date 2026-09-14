import { NextResponse } from "next/server";
import { listKeyRecoveryOrders } from "@/lib/seller/keyRecovery";

export async function GET() {
  const orders = listKeyRecoveryOrders();
  const totalCents = orders.reduce((sum, o) => sum + o.amountCents, 0);
  return NextResponse.json({ orders, totalCents });
}
