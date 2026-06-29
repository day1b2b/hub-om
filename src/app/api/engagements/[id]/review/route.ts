import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseRating, stringValue } from "@/lib/coaches/engagementApi";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rating = parseRating(body.rating);
  if (rating === undefined && body.rating !== undefined) {
    return NextResponse.json({ ok: false, error: "평점은 1~5 사이 정수여야 합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const engagement = await prisma.coachEngagement.update({
    where: { id },
    data: {
      ...(body.rating !== undefined ? { rating: rating ?? null } : {}),
      ...(body.feedback !== undefined ? { feedback: stringValue(body.feedback) } : {}),
      ...(body.rehire !== undefined ? { rehire: typeof body.rehire === "boolean" ? body.rehire : null } : {})
    }
  });

  return NextResponse.json({ ok: true, engagement });
}
