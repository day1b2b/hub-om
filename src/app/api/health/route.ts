import { NextResponse } from "next/server";
import { getDatabaseHealthRepository } from "@/lib/data/databaseHealthFactory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDatabaseHealthRepository().check();

    return NextResponse.json({
      ok: true,
      database: "connected"
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "unavailable",
        error: "Health check failed"
      },
      { status: 503 }
    );
  }
}
