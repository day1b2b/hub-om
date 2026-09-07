import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { generateCoachAccessToken } from "@/lib/coaches/accessToken";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

async function activityPOST(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const prisma = getPrismaClient();
  const coach = await prisma.coach.update({
    where: { id },
    data: { accessToken: generateCoachAccessToken() },
    select: { id: true, accessToken: true }
  });

  return NextResponse.json({ ok: true, accessToken: coach.accessToken });
}

export const POST = withActivity("/api/coaches/[id]/regenerate-token", "POST", activityPOST);
