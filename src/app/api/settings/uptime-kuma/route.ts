import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

const KEY = "uptime_kuma_url";

export async function GET() {
  return NextResponse.json({ url: getSetting(KEY) });
}

export async function PUT(req: NextRequest) {
  const { url } = (await req.json()) as { url?: string };
  if (!url) {
    return NextResponse.json({ error: "URL requise." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = new URL(url).toString();
  } catch {
    return NextResponse.json({ error: "URL invalide (ex: https://uptime.abhd.fr ou http://192.168.0.50:3001)." }, { status: 400 });
  }
  setSetting(KEY, normalized);
  return NextResponse.json({ ok: true, url: normalized });
}
