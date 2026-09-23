import { NextResponse } from "next/server";
import { generateWrapped } from "@/lib/wrapped";

export async function GET() {
  return NextResponse.json({ cards: generateWrapped() });
}
