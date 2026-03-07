import { NextRequest, NextResponse } from "next/server";
import { APPROVED_EMAILS, SESSION_COOKIE, SESSION_SECRET } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code || code.length !== 6) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  if (!APPROVED_EMAILS.includes(email.toLowerCase())) {
    return NextResponse.json({ ok: false, error: "Email not authorized" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, SESSION_SECRET, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
