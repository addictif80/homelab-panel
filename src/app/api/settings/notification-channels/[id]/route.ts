import { NextRequest, NextResponse } from "next/server";
import { removeChannel, updateChannel, type NotificationChannel } from "@/lib/notifications/channels";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = (await req.json()) as Partial<Omit<NotificationChannel, "id">>;
  updateChannel(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeChannel(id);
  return NextResponse.json({ ok: true });
}
