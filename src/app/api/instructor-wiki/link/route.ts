import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import {
  getAllInstructorNotes,
  notionIdKey,
  saveInstructorNote
} from "@/lib/data/instructorWikiStore";

/**
 * "이 강사는 노션의 이 강사" 수동 연결 저장.
 *
 * body: { name: 운영 현황 표기, targetName: 노션 강사명 }  — targetName이 빈 값이면 연결 해제.
 *
 * 연결값은 노션 강사명이 아니라 그 강사의 **노션 페이지 ID**로 저장한다. 이름은 바뀔 수 있고
 * 동명이인도 있어서, 조인 키는 ID여야 안전하다.
 */
export async function POST(request: Request) {
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json({ error: "admin 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { name?: unknown; targetName?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const targetName = typeof body.targetName === "string" ? body.targetName.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "name 필요" }, { status: 400 });
    }

    // 연결 해제
    if (!targetName) {
      await saveInstructorNote(name, { notionId: "" });
      // 저장된 노트를 그대로 돌려주지 않는다. 예전 스냅샷에 연락처·이메일이 남아 있는 경우가
      // 있어 응답으로 개인정보가 새어 나갈 수 있다.
      return NextResponse.json({ ok: true, linked: null });
    }

    if (targetName === name) {
      return NextResponse.json({ error: "자기 자신에는 연결할 수 없습니다." }, { status: 400 });
    }

    const notes = await getAllInstructorNotes();
    const target = notes[targetName];
    if (!target?.notion) {
      return NextResponse.json({ error: "노션 강사 명단에 없는 이름입니다." }, { status: 400 });
    }

    const notionId = notionIdKey(target.notionId);
    if (!notionId) {
      return NextResponse.json({ error: "대상 강사에 노션 페이지 ID가 없습니다. 노션 강사 동기화를 먼저 실행해 주세요." }, { status: 409 });
    }

    await saveInstructorNote(name, { notionId });
    return NextResponse.json({ ok: true, linked: targetName });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
