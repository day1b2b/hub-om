import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireWorkspaceSession();
  const prisma = getPrismaClient();
  const fields = await prisma.coachFieldMaster.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ ok: true, fields });
}

export async function POST(request: Request) {
  await requireWorkspaceSession();
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ ok: false, error: "분야명이 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const field = await prisma.coachFieldMaster.upsert({
    where: { name },
    create: { name },
    update: {}
  });

  return NextResponse.json({ ok: true, field }, { status: 201 });
}
