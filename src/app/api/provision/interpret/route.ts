import { NextRequest, NextResponse } from "next/server";
import { interpretProvisionSentence } from "@/lib/provision";

export async function POST(req: NextRequest) {
  const { sentence } = (await req.json()) as { sentence?: string };
  if (!sentence || !sentence.trim()) {
    return NextResponse.json({ error: "Décris ce que tu veux déployer." }, { status: 400 });
  }
  try {
    const suggestion = await interpretProvisionSentence(sentence.trim());
    return NextResponse.json(suggestion);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
