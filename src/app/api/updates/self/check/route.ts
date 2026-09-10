import { NextResponse } from "next/server";
import { checkForUpdate } from "@/lib/selfUpdate";

export async function GET() {
  const check = await checkForUpdate();
  return NextResponse.json(check);
}
