import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertCoachPiiAccess } from "@/lib/auth/requireAdminSession";
import { buildSkillfloCoachUrl } from "@/lib/coaches/skillfloCoachUrl";
import { createCoachExportRepository } from "@/lib/data/coachExportRepositoryFactory";
import { toCoachExportCsv } from "@/lib/coaches/coachExportCsv";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await assertCoachPiiAccess();

  const body = (await request.json().catch(() => ({}))) as {
    coachIds?: unknown;
    type?: unknown;
  };
  const coachIds = Array.isArray(body.coachIds)
    ? [...new Set(body.coachIds.filter((id): id is string => typeof id === "string").map(id => id.toLowerCase()))]
    : [];
  const type = body.type === "email" || body.type === "mail-merge" ? body.type : "phone";

  if (coachIds.length === 0) {
    return NextResponse.json({ ok: false, error: "내보낼 코치를 선택해주세요." }, { status: 400 });
  }

  if (coachIds.length > 20_000 || coachIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ ok: false, error: "내보낼 코치 목록을 확인해주세요. 한 번에 최대 20,000명까지 선택할 수 있습니다." }, { status: 400 });
  }

  const coaches = await createCoachExportRepository().exportCoaches(coachIds, type, session.user!.email!);

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

  const csv = toCoachExportCsv(rows);
  const label = type === "mail-merge" ? "mail_merge" : type === "email" ? "emails" : "phones";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="coaches_${label}_${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
}

export const POST = withActivity("/api/coaches/export", "POST", activityPOST);
