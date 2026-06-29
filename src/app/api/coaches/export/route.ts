import { NextResponse } from "next/server";
import { assertCoachPiiAccess } from "@/lib/auth/requireAdminSession";
import { buildSkillfloCoachUrl } from "@/lib/coaches/skillfloCoachUrl";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await assertCoachPiiAccess();

  const body = (await request.json().catch(() => ({}))) as {
    coachIds?: unknown;
    type?: unknown;
  };
  const coachIds = Array.isArray(body.coachIds)
    ? body.coachIds.filter((id): id is string => typeof id === "string")
    : [];
  const type = body.type === "email" || body.type === "mail-merge" ? body.type : "phone";

  if (coachIds.length === 0) {
    return NextResponse.json({ ok: false, error: "내보낼 코치를 선택해주세요." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coaches = await prisma.coach.findMany({
    where: {
      id: { in: coachIds },
      deletedAt: null
    },
    select: {
      id: true,
      name: true,
      accessToken: true,
      privateProfile: {
        select: {
          phone: true,
          email: true
        }
      }
    },
    orderBy: { normalizedName: "asc" }
  });

  await prisma.coachPrivateAccessLog.createMany({
    data: coaches.map((coach) => ({
      coachId: coach.id,
      accessedByEmail: session.user!.email!,
      context: `coach_export:${type}`
    }))
  });

  const rows = coaches.map<Record<string, string>>((coach) => {
    if (type === "mail-merge") {
      const row: Record<string, string> = {
        "이름": coach.name,
        "이메일": coach.privateProfile?.email ?? "",
        "링크": buildSkillfloCoachUrl(coach.accessToken) ?? ""
      };
      return row;
    }
    if (type === "email") {
      const row: Record<string, string> = {
        "이름": coach.name,
        "이메일": coach.privateProfile?.email ?? ""
      };
      return row;
    }
    const row: Record<string, string> = {
      "이름": coach.name,
      "휴대폰번호": coach.privateProfile?.phone ?? ""
    };
    return row;
  });

  const csv = toCsv(rows);
  const label = type === "mail-merge" ? "mail_merge" : type === "email" ? "emails" : "phones";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="coaches_${label}_${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header] ?? "")).join(","))
  ];
  return `\uFEFF${lines.join("\n")}`;
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
