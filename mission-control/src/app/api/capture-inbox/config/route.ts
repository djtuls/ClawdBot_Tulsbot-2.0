import { NextRequest, NextResponse } from "next/server";
import { readCaptureInboxConfig, writeCaptureInboxConfig } from "@/lib/captureInboxStore";

export async function GET() {
  return NextResponse.json(readCaptureInboxConfig());
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const current = readCaptureInboxConfig();
  const next = writeCaptureInboxConfig({ ...current, ...body });
  return NextResponse.json(next);
}
