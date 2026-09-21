import { NextResponse } from "next/server";
import { generateOutageReportText } from "@/lib/isp/report";

export async function GET() {
  const text = generateOutageReportText();
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="preuve-panne-fai-${new Date().toISOString().slice(0, 10)}.txt"`,
    },
  });
}
