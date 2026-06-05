import { NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      database: "connected"
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "unavailable",
        error:
          process.env.NODE_ENV === "production"
            ? "Health check failed"
            : error instanceof Error
              ? error.message
              : "Unknown health check error"
      },
      { status: 503 }
    );
  }
}
