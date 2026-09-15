import { NextRequest, NextResponse } from "next/server";
import { listAppTemplates, createAppTemplate, type AppTemplateInput } from "@/lib/appTemplates";
import { logAudit } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ templates: listAppTemplates() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<AppTemplateInput>;
  if (!body.name?.trim() || !body.image?.trim()) {
    return NextResponse.json({ error: "Nom et image requis." }, { status: 400 });
  }
  const template = createAppTemplate({
    name: body.name.trim(),
    description: body.description?.trim() || "",
    image: body.image.trim(),
    ports: body.ports || [],
    volumes: body.volumes || [],
    env: body.env || [],
    restartPolicy: body.restartPolicy || "unless-stopped",
  });
  logAudit("docker.template_created", template.id, template.name);
  return NextResponse.json({ template });
}
