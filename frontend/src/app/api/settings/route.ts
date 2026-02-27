import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    workingDir: process.env.WORKING_DIR || "",
    backendUrl: process.env.BACKEND_URL || "http://localhost:8000",
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    hasSupabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
}
