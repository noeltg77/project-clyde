import { NextResponse } from "next/server";

export async function GET() {
  try {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    const res = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json({ frontend: "ok", backend: data });
  } catch {
    return NextResponse.json(
      { frontend: "ok", backend: "unreachable" },
      { status: 503 }
    );
  }
}
