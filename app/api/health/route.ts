import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      service: "medi-bot-agency-v3",
      timestamp: new Date().toISOString()
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
