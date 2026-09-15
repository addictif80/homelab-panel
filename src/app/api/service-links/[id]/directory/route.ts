import { NextRequest, NextResponse } from "next/server";
import { getServiceLink, setServiceLinkDirectoryState } from "@/lib/serviceLinks";
import { getDirectoryOwnerName, submitToDirectory, withdrawFromDirectory } from "@/lib/directorySubmission";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = getServiceLink(id);
  if (!link) return NextResponse.json({ error: "Lien introuvable." }, { status: 404 });

  const { optIn } = (await req.json().catch(() => ({}))) as { optIn?: boolean };

  if (optIn) {
    const ownerName = getDirectoryOwnerName();
    if (!ownerName) {
      return NextResponse.json(
        { error: "Renseigne un nom public dans Réglages avant de soumettre un service à l'annuaire." },
        { status: 400 }
      );
    }
    const result = await submitToDirectory({
      ownerName,
      serviceName: link.name,
      serviceUrl: link.url,
      description: link.description,
      faviconDataUrl: link.faviconDataUrl,
      screenshotDataUrl: link.screenshotDataUrl,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    setServiceLinkDirectoryState(id, { optIn: true, status: result.status, submissionId: result.submissionId });
    logAudit("service_link.directory_submitted", id, link.name);
  } else {
    if (link.directorySubmissionId) await withdrawFromDirectory(link.directorySubmissionId);
    setServiceLinkDirectoryState(id, { optIn: false, status: "none", submissionId: null });
    logAudit("service_link.directory_withdrawn", id, link.name);
  }

  return NextResponse.json({ link: getServiceLink(id) });
}
