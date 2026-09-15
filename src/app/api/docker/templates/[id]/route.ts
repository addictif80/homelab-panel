import { NextRequest, NextResponse } from "next/server";
import { updateAppTemplate, deleteAppTemplate, type AppTemplateInput } from "@/lib/appTemplates";
import { logAudit } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<AppTemplateInput>;
  if (!body.name?.trim() || !body.image?.trim()) {
    return NextResponse.json({ error: "Nom et image requis." }, { status: 400 });
  }
  try {
    const template = updateAppTemplate(id, {
      name: body.name.trim(),
      description: body.description?.trim() || "",
      image: body.image.trim(),
      ports: body.ports || [],
      volumes: body.volumes || [],
      env: body.env || [],
      restartPolicy: body.restartPolicy || "unless-stopped",
    });
    logAudit("docker.template_updated", id, template.name);
    return NextResponse.json({ template });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteAppTemplate(id);
  logAudit("docker.template_deleted", id);
  return NextResponse.json({ ok: true });
}
