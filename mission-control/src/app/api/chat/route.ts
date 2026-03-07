import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "/opt/homebrew/bin/openclaw";

export async function POST(req: NextRequest) {
  const { message, context } = await req.json();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  try {
    const prompt = context ? `[Context: ${context}]\n\n${message}` : message;

    const { stdout, stderr } = await execFileAsync(
      OPENCLAW_BIN,
      ["agent", "--agent", "main", "--json", "--message", prompt],
      {
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: process.env.HOME || "/Users/tulioferro",
          PATH: "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin",
        },
      },
    );

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ reply: stdout.trim() || stderr.trim() || "No response" });
    }

    try {
      const data = JSON.parse(jsonMatch[0]);
      const reply =
        data?.payloads?.[0]?.text ||
        data?.result?.payloads?.[0]?.text ||
        data?.result?.text ||
        data?.text ||
        (typeof data === "string" ? data : JSON.stringify(data, null, 2));
      return NextResponse.json({ reply });
    } catch {
      return NextResponse.json({ reply: stdout.trim() || stderr.trim() || "No response" });
    }
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: "Agent call failed", detail: error.stderr || error.message || String(err) },
      { status: 502 },
    );
  }
}
