import { NextRequest, NextResponse } from "next/server";
import { addChannel, listChannels, redactChannel, type ChannelType } from "@/lib/notifications/channels";

export async function GET() {
  return NextResponse.json({ channels: listChannels().map(redactChannel) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    type?: ChannelType;
    label?: string;
    url?: string;
    ntfyServer?: string;
    ntfyTopic?: string;
    ntfyToken?: string;
  };
  if (!body.type || !["webhook", "ntfy", "discord", "slack"].includes(body.type)) {
    return NextResponse.json({ error: "Type de canal invalide." }, { status: 400 });
  }
  if (body.type !== "ntfy" && !body.url) {
    return NextResponse.json({ error: "URL requise pour ce type de canal." }, { status: 400 });
  }
  if (body.type === "ntfy" && !body.ntfyTopic) {
    return NextResponse.json({ error: "Sujet (topic) ntfy requis." }, { status: 400 });
  }

  const created = addChannel({
    type: body.type,
    label: body.label || body.type,
    enabled: true,
    url: body.url,
    ntfyServer: body.ntfyServer,
    ntfyTopic: body.ntfyTopic,
    ntfyToken: body.ntfyToken,
  });
  return NextResponse.json({ channel: redactChannel(created) }, { status: 201 });
}
