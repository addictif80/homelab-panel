import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";
import { getDbConnection } from "@/lib/dbManager/sqlRunner";
import { restoreDatabaseFromStream, MAX_IMPORT_BYTES } from "@/lib/dbManager/dumpRestore";
import { logAudit } from "@/lib/db";

// A restore blocks on the full upload anyway — the browser only finishes sending the request
// once the whole file has gone out, so there's nothing to gain (and real risk of reading from a
// request the runtime already considers finished) in returning early and consuming req.body in
// the background the way the old base64/job-polling version did.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; db: string }> }) {
  const { id, db } = await params;
  const database = decodeURIComponent(db);
  const isGzip = req.headers.get("x-is-gzip") === "1";

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (declaredLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 1 Go)." }, { status: 413 });
  }
  if (!req.body) return NextResponse.json({ error: "Fichier requis." }, { status: 400 });

  let conn;
  try {
    conn = getDbConnection(id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connexion introuvable." }, { status: 404 });
  }

  // Enforced again on the bytes actually received, not just the declared header — a client could
  // omit or misreport Content-Length.
  let received = 0;
  const nodeInput = Readable.fromWeb(req.body as NodeWebReadableStream<Uint8Array>);
  nodeInput.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_IMPORT_BYTES) {
      nodeInput.destroy(new Error("Fichier trop volumineux (max 1 Go)."));
    }
  });

  try {
    await restoreDatabaseFromStream(conn, database, nodeInput, isGzip);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lors de la restauration." }, { status: 502 });
  }

  logAudit("dbmanager.database_restored", id, db);
  return NextResponse.json({ ok: true });
}
