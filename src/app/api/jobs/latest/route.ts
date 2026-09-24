import { NextRequest, NextResponse } from "next/server";
import { getLatestJob } from "@/lib/jobs";

/** Called on page mount by any feature that wants to resume showing progress for a job it didn't
 * itself just start — e.g. the panel was reopened, or the action was launched from another
 * device. `kind` is required; `hostId` narrows to jobs for one specific host. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  if (!kind) return NextResponse.json({ error: "Paramètre 'kind' requis." }, { status: 400 });
  const hostIdParam = req.nextUrl.searchParams.get("hostId");
  const hostId = hostIdParam ? Number(hostIdParam) : undefined;
  return NextResponse.json({ job: getLatestJob(kind, hostId) });
}
