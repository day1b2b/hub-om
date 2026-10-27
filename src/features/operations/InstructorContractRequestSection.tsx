// 운영현황 교육상세 "강사 계약요청" 구역.
// 이 과정(회차들)의 강사별로, 값이 채워진 구글 계약폼을 여는 링크를 보여준다.
// 서버 컴포넌트: 응답시트를 읽지 않고 운영현황 데이터만으로 프리필 URL을 만든다(핫 페이지 지연 0).
// 이메일·계약 진행상태(응답시트 기반)는 다음 단계에서 보강한다.
import { buildContractPrefillUrl } from "@/lib/instructors/instructorContractPrefill";
import { buildInstructorContractRequests } from "@/lib/instructors/instructorContractRequests";
import type { OperationSession } from "@/lib/data/operationTypes";

interface InstructorContractRequestSectionProps {
  courseOperations: OperationSession[];
}

export function InstructorContractRequestSection({ courseOperations }: InstructorContractRequestSectionProps) {
  // 아직 응답시트를 읽지 않으므로 requested=false·email 없음으로 만든다(폼에서 수동 입력).
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
        <ul className="instructor-contract-list">
          {requests.map((request) => (
            <li className="instructor-contract-item" key={`${request.courseId}-${request.instructorName}`}>
              <div className="instructor-contract-meta">
                <span className="instructor-contract-name">{request.instructorName}</span>
                {request.schedule ? <span className="instructor-contract-schedule">{request.schedule}</span> : null}
              </div>
              <a
                className="instructor-contract-open"
                href={buildContractPrefillUrl({
                  courseId: request.courseId,
                  courseName: request.courseName,
                  instructorName: request.instructorName,
                  schedule: request.schedule,
                  manager: request.manager,
                  email: request.email
                })}
                rel="noopener noreferrer"
                target="_blank"
              >
                계약폼 열기 ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
