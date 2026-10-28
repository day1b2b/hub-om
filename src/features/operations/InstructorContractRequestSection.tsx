// 운영현황 교육상세 "강사 계약요청" 구역(서버 컴포넌트).
// 이 과정(회차들)의 강사별로 계약요청 대상을 만들어 클라이언트 목록에 넘긴다. 서버에선 응답시트를
// 읽지 않으므로(핫 페이지 지연 0) requested=false·email 없음 상태로 만든다. 상태·이메일 보강은
// InstructorContractList가 버튼 클릭 때 라우트로 가져온다.
import { buildInstructorContractRequests } from "@/lib/instructors/instructorContractRequests";
import type { OperationSession } from "@/lib/data/operationTypes";
import { InstructorContractList } from "./InstructorContractList";

interface InstructorContractRequestSectionProps {
  courseOperations: OperationSession[];
}

export function InstructorContractRequestSection({ courseOperations }: InstructorContractRequestSectionProps) {
  const requests = buildInstructorContractRequests(courseOperations, []);

  return (
    <section className="detail-section instructor-contract-section">
      <div className="section-title">
        <h2>강사 계약요청</h2>
        {requests.length > 0 ? <span>{requests.length}명</span> : null}
      </div>
      <p className="instructor-contract-hint">
        강사·코스·일정·담당자가 채워진 계약폼이 열립니다. 이메일·강사료·계약유형은 폼에서 확인·입력하세요.
      </p>
      {requests.length === 0 ? (
        <p className="instructor-contract-empty">등록된 강사가 없습니다. 회차 목록에서 강사를 입력하세요.</p>
      ) : (
        <InstructorContractList items={requests} />
      )}
    </section>
  );
}
