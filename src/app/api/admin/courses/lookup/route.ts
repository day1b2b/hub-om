import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { formatProcessId } from "@/lib/data/operationCalculations";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

function parseProcessSeq(rawProcessId: string): number | null {
  const match = /^PRC-(\d+)$/i.exec(rawProcessId.trim());
  if (!match) return null;

  const processSeq = Number(match[1]);
  return Number.isInteger(processSeq) ? processSeq : null;
}

export async function GET(request: Request) {
  await assertAdminSession();

  const processId = new URL(request.url).searchParams.get("processId") ?? "";
  const processSeq = parseProcessSeq(processId);

  if (processSeq === null) {
    return NextResponse.json({ ok: false, error: "과정ID 형식이 올바르지 않습니다. 예: PRC-000533" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const course = await prisma.course.findUnique({
    where: { processSeq },
    select: {
      id: true,
      processSeq: true,
      name: true,
      company: { select: { name: true } },
      sessions: { where: { deletedAt: null }, select: { id: true } }
    }
  });

  if (!course) {
    return NextResponse.json({ ok: false, error: "해당 과정ID를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    course: {
      courseRecordId: course.id,
      processId: formatProcessId(course.processSeq),
      companyName: course.company.name,
      courseName: course.name,
      activeSessionCount: course.sessions.length
    }
  });
}
