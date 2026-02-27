import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const sessionId = searchParams.get("session_id") || "";

  if (!q.trim()) {
    return NextResponse.json({ results: [] });
  }

  try {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    const params = new URLSearchParams({ q: q.trim() });
    if (sessionId) params.set("session_id", sessionId);

    const res = await fetch(`${backendUrl}/api/search?${params}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { results: [], error: `Backend returned ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[search] Backend unreachable:", err);
    return NextResponse.json(
      { results: [], error: "Backend unreachable" },
      { status: 503 }
    );
  }
}
