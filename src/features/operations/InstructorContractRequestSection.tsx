// 운영현황 교육상세 "강사 계약 현황" 구역(서버 컴포넌트).
// 이 과정(회차들)의 강사별로 계약요청 대상을 만들어 클라이언트 목록에 넘긴다. 서버에선 응답시트·모두싸인을
// 부르지 않고(핫 페이지 지연 0), 08:00·12:00 예약 작업이 만든 진행상태 스냅샷(로컬 암호화 파일)만 읽어
// 단계(요청됨·발송됨·서명 진행)를 바로 보여준다. 이메일 보강·즉시 새로고침은 InstructorContractList 버튼이 한다.
// 계약요청은 강사 배정 직후에 하는 일이라, 배정 단계에선 "지금 할 일"로 강조하고 교육이 끝나면 접어 둔다.
import { resolveDepartmentChoice } from "@/lib/instructors/instructorContractPrefill";
import { buildInstructorContractRequests } from "@/lib/instructors/instructorContractRequests";
import { isSigningTracked } from "@/lib/instructors/instructorContractSigning";
import { ensureSigningSnapshot, progressKey, readCourseProgress } from "@/lib/instructors/instructorContractSigningSnapshot";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { CourseStage } from "./courseStage";
import { InstructorContractList } from "./InstructorContractList";

interface InstructorContractRequestSectionProps {
  courseOperations: OperationSession[];
  stage: CourseStage;
  /** normalizePersonKey(멤버 이름) → 팀("AX 1파트" 등). 계약폼 "소속 및 부서장" 자동 선택용. */
  teamByPersonKey?: Readonly<Record<string, string>>;
}

export function InstructorContractRequestSection({ courseOperations, stage, teamByPersonKey = {} }: InstructorContractRequestSectionProps) {
  const requests = buildInstructorContractRequests(courseOperations, []).map((request) => ({
    ...request,
    department: resolveDepartmentChoice(request.manager, teamByPersonKey)
  }));
  // 스냅샷을 못 읽어도(파일 없음·복호화 실패) 화면은 그대로 둔다 — 버튼으로 불러올 수 있다.
  let progress: ReturnType<typeof readCourseProgress> = null;
  try {
    progress = readCourseProgress(requests);
    if (!progress) ensureSigningSnapshot();
  } catch {
    progress = null;
  }
  const initialProgress = progress
    ? {
        modusignSynced: progress.modusignSynced,
        syncedAt: progress.syncedAt,
        byKey: Object.fromEntries(
          requests.flatMap((item) => {
            const entry = progress.entries[progressKey(item.courseId, item.instructorName)];
            return entry ? [[`${item.courseId}\u0000${item.instructorName}`, entry]] : [];
          })
        )
      }
    : null;
  const courseStartDate = courseOperations.map((operation) => operation.startDate).filter(Boolean).sort()[0];
  const focused = stage === "contract" && requests.length > 0;

  const title = (
    <div className="section-title">
      <h2>강사 계약 현황</h2>
      {requests.length === 0 ? (
        <span className="stage-badge stage-badge--wait">대기</span>
      ) : focused ? (
        <span className="stage-badge stage-badge--now">지금 할 일 · {requests.length}명</span>
      ) : (
        <span>{requests.length}명</span>
      )}
    </div>
  );

  const body =
    requests.length === 0 ? (
      <p className="instructor-contract-empty">회차에 강사를 넣으면 여기서 바로 계약요청을 할 수 있어요.</p>
    ) : (
      <InstructorContractList initialProgress={initialProgress} items={requests} signingTracked={isSigningTracked(courseStartDate)} />
    );

  // 교육이 끝난 과정은 계약 단계가 지났으니 접어 둔다(필요하면 펼쳐 본다).
  if (stage === "review" && requests.length > 0) {
    return (
      <details className="detail-section instructor-contract-section">
        <summary>{title}</summary>
        {body}
      </details>
    );
  }

  return (
    <section className={`detail-section instructor-contract-section${focused ? " stage-focus" : ""}`}>
      {title}
      {body}
    </section>
  );
}
