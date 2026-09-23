import { NextRequest, NextResponse } from "next/server";
import { listDatabases } from "@/lib/backup/sources/database";

/** Lists the databases a set of (not-yet-saved) credentials can see — powers the "Tester la
 * connexion" button in the plan editor, so someone picks database names from a real list instead
 * of typing them blind. Takes the password in plaintext in the request body since this tests
 * credentials the user just typed, before they're encrypted and saved as a plan. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    hostId?: number;
    deployment?: "docker" | "native";
    containerId?: string;
    engine?: "mysql" | "postgres";
    user?: string;
    password?: string;
  };

  if (!body.hostId || !body.engine || !body.user || !body.password) {
    return NextResponse.json({ error: "Machine, moteur, utilisateur et mot de passe requis." }, { status: 400 });
  }
  if (body.deployment !== "native" && !body.containerId) {
    return NextResponse.json({ error: "Conteneur de la base de données requis." }, { status: 400 });
  }

  try {
    const databases = await listDatabases(body.hostId, {
      deployment: body.deployment,
      containerId: body.containerId,
      engine: body.engine,
      user: body.user,
      password: body.password,
    });
    return NextResponse.json({ databases });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion impossible." }, { status: 400 });
  }
}
