// 운영현황 교육상세 "강사 계약요청" 구역(서버 컴포넌트).
// 이 과정(회차들)의 강사별로 계약요청 대상을 만들어 클라이언트 목록에 넘긴다. 서버에선 응답시트를
// 읽지 않으므로(핫 페이지 지연 0) requested=false·email 없음 상태로 만든다. 상태·이메일 보강은
// InstructorContractList가 버튼 클릭 때 라우트로 가져온다.
// 계약요청은 강사 배정 직후에 하는 일이라, 배정 단계에선 "지금 할 일"로 강조하고 교육이 끝나면 접어 둔다.
import { buildInstructorContractRequests } from "@/lib/instructors/instructorContractRequests";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { CourseStage } from "./courseStage";
import { InstructorContractList } from "./InstructorContractList";

interface InstructorContractRequestSectionProps {
  courseOperations: OperationSession[];
  stage: CourseStage;
}

export function InstructorContractRequestSection({ courseOperations, stage }: InstructorContractRequestSectionProps) {
  const requests = buildInstructorContractRequests(courseOperations, []);
  const focused = stage === "contract" && requests.length > 0;

  const title = (
    <div className="section-title">
      <h2>강사 계약요청</h2>
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
      <>
        <p className="instructor-contract-hint">
          강사·코스·일정·담당자가 채워진 계약폼이 열립니다. 이메일·강사료·계약유형은 폼에서 확인·입력하세요.
        </p>
        <InstructorContractList items={requests} />
      </>
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
