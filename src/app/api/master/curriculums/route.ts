import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

async function activityGET() {
  await requireWorkspaceSession();
  const prisma = getPrismaClient();
  const curriculums = await prisma.coachCurriculumMaster.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ ok: true, curriculums });
}

async function activityPOST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ ok: false, error: "커리큘럼명이 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const curriculum = await prisma.coachCurriculumMaster.upsert({
    where: { name },
    create: { name },
    update: {}
  });

  return NextResponse.json({ ok: true, curriculum }, { status: 201 });
}

export const GET = withActivity("/api/master/curriculums", "GET", activityGET);

export const POST = withActivity("/api/master/curriculums", "POST", activityPOST);
