import { NextRequest, NextResponse } from "next/server";
import { listContainerDirectory } from "@/lib/docker";

/** Browses one directory level *inside* a running container's filesystem — for the "Parcourir"
 * button on a log-file path that only exists inside the container (see DirectoryPicker's
 * `containerId` prop), as opposed to /api/files/[hostId], which browses the host's own filesystem
 * over SFTP and can't see inside a container at all. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string; containerId: string }> }
) {
  const { hostId, containerId } = await params;
  const path = req.nextUrl.searchParams.get("path") || "/";
  try {
    const entries = await listContainerDirectory(Number(hostId), containerId, path);
    return NextResponse.json({ path, entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur Docker." }, { status: 502 });
  }
}
