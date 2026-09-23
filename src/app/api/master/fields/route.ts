import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachAdminRepository } from "@/lib/data/coachAdminRepositoryFactory";

export const dynamic = "force-dynamic";

async function activityGET() {
  await requireWorkspaceSession();
  const fields = await getCoachAdminRepository().listMasters("fields");
  return NextResponse.json({ ok: true, fields });
}

async function activityPOST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ ok: false, error: "분야명이 필요합니다." }, { status: 400 });
  }

  const field = await getCoachAdminRepository().ensureMaster("fields", name);

  return NextResponse.json({ ok: true, field }, { status: 201 });
}

export const GET = withActivity("/api/master/fields", "GET", activityGET);

export const POST = withActivity("/api/master/fields", "POST", activityPOST);
