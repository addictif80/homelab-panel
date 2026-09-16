import { NextRequest, NextResponse } from "next/server";
import { addDbConnection, listDbConnections } from "@/lib/dbManager/dbConnections";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ connections: listDbConnections() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    hostId?: number;
    label?: string;
    engine?: "mysql" | "postgres";
    containerId?: string | null;
    dbHost?: string;
    dbPort?: number;
    username?: string;
    password?: string;
  };
  if (!body.hostId || !body.label?.trim() || !body.engine || !body.username?.trim() || !body.password) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  if (body.engine !== "mysql" && body.engine !== "postgres") {
    return NextResponse.json({ error: "Moteur invalide." }, { status: 400 });
  }

  const id = addDbConnection({
    hostId: body.hostId,
    label: body.label,
    engine: body.engine,
    containerId: body.containerId ?? null,
    dbHost: body.dbHost || "127.0.0.1",
    dbPort: body.dbPort || (body.engine === "mysql" ? 3306 : 5432),
    username: body.username,
    password: body.password,
  });
  logAudit("dbmanager.connection_added", id, body.label);
  return NextResponse.json({ id });
}
