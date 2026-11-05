// 교육상세 "강사 계약요청" 확인 창을 열 때 그 강사 1명의 이메일을 노션 강사 정보(hub 암호화 저장본)에서 읽는다.
// [지금 새로고침] 없이도 프리필에 이메일이 들어가게 하려는 것. 한 요청에 강사 1명, 열람은 감사 로그에
// context "contract_request"로 남긴다(마스킹 열람 /api/pii/reveal과 같은 테이블). 이메일은 저장하지 않고 돌려주기만 한다.
// 동명이인·못 찾음은 email 없이 ok로 돌려준다(확인 창은 "비어 있음 · 폼에서 입력", 폼 열기는 막지 않음).
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
import { revealInstructorEmailForContractRequest } from "@/lib/data/piiReveal";
import { resolveContractInstructorNoteId } from "@/lib/instructors/instructorContractEmail";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await requireWorkspaceSession();
  const accessedBy = session.user?.email ?? "";

  let instructorName = "";
  try {
    const body = (await request.json()) as { instructorName?: unknown };
    instructorName = typeof body.instructorName === "string" ? body.instructorName.trim() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!instructorName || !accessedBy) {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const notes = await listInstructorNotes();
    const noteId = resolveContractInstructorNoteId(notes, resolveNotionLinkTargets(notes), instructorName);
    if (!noteId) return NextResponse.json({ ok: true });
    const email = await revealInstructorEmailForContractRequest(noteId, accessedBy);
    return NextResponse.json(email ? { ok: true, email } : { ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "이메일을 불러오지 못했습니다." }, { status: 500 });
  }
}

export const POST = withActivity("/api/operations/instructor-contract-email", "POST", activityPOST);
