import { NextResponse } from "next/server";
import { getDatabaseHealthRepository } from "@/lib/data/databaseHealthFactory";
import { runHealthRequest } from "@/lib/data/healthComposition";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await runHealthRequest(async () => {
      await getDatabaseHealthRepository().check();

      return NextResponse.json({
        ok: true,
        database: "connected"
      });
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
