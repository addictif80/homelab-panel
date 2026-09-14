import { NextResponse } from "next/server";
import { deleteStack } from "@/lib/dockerStacks";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteStack(id);
  return NextResponse.json({ ok: true });
}
