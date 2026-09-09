import { NextRequest, NextResponse } from "next/server";
import { startCopyJob } from "@/lib/fileCopy";
import { logAudit } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { sourceHostId, sourcePath, destHostId, destPath } = (await req.json()) as {
    sourceHostId?: number;
    sourcePath?: string;
    destHostId?: number;
    destPath?: string;
  };

  if (!sourceHostId || !sourcePath || !destHostId || !destPath) {
    return NextResponse.json({ error: "Machine et chemin source/destination requis." }, { status: 400 });
  }

  if (sourceHostId === destHostId) {
    const normalizedSource = sourcePath.endsWith("/") ? sourcePath : `${sourcePath}/`;
    if (destPath === sourcePath || destPath.startsWith(normalizedSource)) {
      return NextResponse.json(
        { error: "Le dossier de destination ne peut pas être le dossier source ou un de ses sous-dossiers." },
        { status: 400 }
      );
    }
  }

  const jobId = startCopyJob(sourceHostId, sourcePath, destHostId, destPath);
  logAudit("files.copy", `${sourceHostId}->${destHostId}`, `${sourcePath} -> ${destPath}`);
  return NextResponse.json({ jobId }, { status: 202 });
}
