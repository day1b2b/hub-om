// 교육상세 "강사 계약요청"의 상태·이메일 보강. (코스ID×강사명) 쌍마다 계약 응답시트 기준으로
// 이미 요청됐는지(requested)와 시트에 있는 강사 이메일을 돌려준다. 시트만 읽고(서비스계정) 데이터
// repository는 쓰지 않으므로 withActivity에 composition을 걸지 않는다(calendar/refresh-events와 동형).
// 이메일은 저장하지 않고 요청시점에만 읽어 돌려준다(instructorNotePii 원칙 유지). 시트를 통째로
// 내려주지 않고 요청한 (코스ID×강사) 쌍에 대해서만 상태·이메일을 돌려준다. 다만 이메일 매칭은
// 강사명 기준이라(동명이인 모호값은 비움), 호출자가 임의 강사명을 넣으면 그 이름의 이메일을 얻을
// 수 있다 — 이는 OM이 계약 응답시트에서 이미 볼 수 있는 값과 동일 범위다. 과정 로스터로 엄격히
// 제한하려면 서버에서 operations를 읽어야 하며(설계 변경), 현재는 하지 않는다.
// 운영현황 상세는 핫 페이지라, 상세 진입 때가 아니라 OM이 이 구역에서 버튼을 눌렀을 때만 읽는다.
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { readInstructorContractRecords } from "@/lib/instructors/instructorContractSheet";
import { resolveInstructorContractStatus, type ContractStatusPair } from "@/lib/instructors/instructorContractRequests";

export const dynamic = "force-dynamic";

function parsePairs(value: unknown): ContractStatusPair[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((pair): pair is Record<string, unknown> => typeof pair === "object" && pair !== null)
    .map((pair) => ({
      courseId: typeof pair.courseId === "string" ? pair.courseId : "",
      instructorName: typeof pair.instructorName === "string" ? pair.instructorName : ""
    }))
    .filter((pair) => pair.instructorName.trim() !== "");
}

async function activityPOST(request: Request) {
  await requireWorkspaceSession();

  let pairs: ContractStatusPair[];
  try {
    const body = (await request.json()) as { pairs?: unknown };
    pairs = parsePairs(body.pairs);
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (pairs.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  try {
    const records = await readInstructorContractRecords();
    return NextResponse.json({ ok: true, items: resolveInstructorContractStatus(records, pairs) });
  } catch {
    // instructorContractSheet가 원인(시트 ID 미설정/권한/범위)을 분류해 던지지만, 외부로는 간단히 안내한다.
    return NextResponse.json({ ok: false, error: "강사 계약 시트를 읽지 못했습니다." }, { status: 502 });
  }
}

export const POST = withActivity("/api/operations/instructor-contract-status", "POST", activityPOST);
