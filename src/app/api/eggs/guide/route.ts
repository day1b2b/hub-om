import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getEggRepository } from "@/lib/data/eggs/prismaEggRepository";
import { isEggPart } from "@/lib/data/eggs/eggTypes";

export const dynamic = "force-dynamic";

const MAX_GUIDE_LENGTH = 5000;

/** 파트별 주의사항 저장 (admin 전용) */
async function activityPUT(request: Request) {
  let actorEmail = "";
  try {
    const session = await assertAdminSession();
    actorEmail = session.user?.email ?? "";
  } catch {
    return NextResponse.json({ ok: false, error: "주의사항은 관리자만 수정할 수 있습니다." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const body = (raw ?? {}) as { part?: unknown; content?: unknown };
  if (!isEggPart(body.part)) {
    return NextResponse.json({ ok: false, error: "파트를 지정해주세요." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (content.length > MAX_GUIDE_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `주의사항은 ${MAX_GUIDE_LENGTH}자까지 저장할 수 있습니다.` },
      { status: 400 }
    );
  }

  try {
    const guide = await getEggRepository().saveGuide(body.part, content, actorEmail);
    return NextResponse.json({ ok: true, guide });
  } catch {
    return NextResponse.json({ ok: false, error: "주의사항 저장에 실패했습니다." }, { status: 500 });
  }
}

export const PUT = withActivity("/api/eggs/guide", "PUT", activityPUT);
