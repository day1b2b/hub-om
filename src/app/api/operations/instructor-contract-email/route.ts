// 교육상세 "강사 계약요청" 확인 창을 열 때 그 강사 1명의 (1) 이메일과 (2) 강사료 참고값을 돌려준다.
// (1) 이메일: 노션 강사 정보(hub 암호화 저장본)에서 읽는다. [지금 새로고침] 없이도 프리필에 들어가게 하려는 것.
//     열람은 감사 로그에 context "contract_request"로 남긴다(마스킹 열람 /api/pii/reveal과 같은 테이블). 저장하지 않는다.
//     화면이 이미 이메일을 알고 있으면(skipEmail) 열람하지 않는다 — 감사 기록도 남지 않는다.
// (2) 강사료 참고값: 계약 시트의 직전 계약 시간당 강사료 + 노션 기본 강사료. 폼에는 넣지 않고 확인 창에만 보인다.
// 동명이인·못 찾음·시트 실패는 해당 값 없이 ok로 돌려준다(확인 창은 비워 두고, 폼 열기는 막지 않음).
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
import { revealInstructorEmailForContractRequest } from "@/lib/data/piiReveal";
import {
  findLastContractFee,
  notionBaseFee,
  resolveContractInstructorNoteId,
  type ContractFeeHint
} from "@/lib/instructors/instructorContractEmail";
import { readInstructorContractRecords } from "@/lib/instructors/instructorContractSheet";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await requireWorkspaceSession();
  const accessedBy = session.user?.email ?? "";

  let instructorName = "";
  let skipEmail = false;
  try {
    const body = (await request.json()) as { instructorName?: unknown; skipEmail?: unknown };
    instructorName = typeof body.instructorName === "string" ? body.instructorName.trim() : "";
    skipEmail = body.skipEmail === true;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!instructorName || !accessedBy) {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const [notes, records] = await Promise.all([
      listInstructorNotes(),
      // 시트를 못 읽어도 이메일은 돌려준다(직전 계약 참고값만 빠짐).
      readInstructorContractRecords().catch(() => [])
    ]);
    const noteId = resolveContractInstructorNoteId(notes, resolveNotionLinkTargets(notes), instructorName);
    const feeHint: ContractFeeHint = {
      lastContract: findLastContractFee(records, instructorName),
      notionBase: notionBaseFee(noteId ? notes.find((note) => note.id === noteId) : undefined)
    };
    const email = noteId && !skipEmail ? await revealInstructorEmailForContractRequest(noteId, accessedBy) : null;
    return NextResponse.json(email ? { ok: true, email, feeHint } : { ok: true, feeHint });
  } catch {
    return NextResponse.json({ ok: false, error: "이메일을 불러오지 못했습니다." }, { status: 500 });
  }
}

export const POST = withActivity("/api/operations/instructor-contract-email", "POST", activityPOST);
