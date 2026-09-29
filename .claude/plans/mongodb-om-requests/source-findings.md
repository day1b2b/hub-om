# 실제 호출 조사
기준383d804. 조사Sartre/Euclid read-only, 메인검토.
POST core성공201,연결/도구/Slack/meta각실패best-effort. 재제출은중복가능. 날짜있는session만차수생성,request.courseId전달(오래된주석과다름),결과보고N모두patch. 연결중간실패는이전회차남고representative없을수있음. ldEmail후속저장실패도접수유지. 변경정책추가안함.
PATCH 관리자/저장ldEmail작성자만;legacyemail없으면작성자거부.DELETE관리자또는미배정작성자만,요청물리삭제·operation유지. 수정은operation/알림변경없음. POST자체401추가안함(인증proxy의존).
assign은별도권한:team관리자유일이메일/기존override,admin자동권한아님. previewPOST/PATCH+no-store,10분token,생성metadataUUIDbatch로전체연결확정. 수동name/id확인후변경/취소,완료상태유지. 옛syncAssignedOmToLinkedOperation helper는실route에서안씀. proposal문서는옛가정이므로실코드/assignment-confirmation-integration이우선.
페이지new:customtools/teamUsers/operations/instructorNote. detail:operations/roleRoster/allrequests/teamUsers. getTeamMemberRepository는context미지원(현재listRoleRosters는Notion호출없이fallback);getStoredTeamMemberRepository는지원. actual페이지UI leaf만대역으로서버조회결과검증가능. 전체브라우저/로그인/배포는별도.
Mongo snapshot의no-op문서경합은 A→writer로직렬화가능,무조건FAIL이나새writefence추가금지. 전체assignment동등성증거는별도Task에서실DB로확인.

## 동시성 검토 결론과 수락된 범위

- 요청 sessions 경쟁: assignment A가 요청의 assignedOm/status를 변경하지 않고 회차만 쓰는 동안 일반 요청 writer가 sessions를 수정해도 A→writer 순서가 가능하다. `omRequestLocalRepository.ts:159`의 writer는 연결 회차를 읽거나 수정하지 않는다. A도 요청 문서를 쓰면 Mongo에서는 같은 문서 쓰기 충돌 대상이다.
- no-op 회차 경쟁: A가 S1을 읽고 건너뛰며 S2만 변경하는 동안 수동 writer가 S1을 변경하는 경우도 A→writer 순서가 가능하다. `mongoOperationRepository.ts:202`의 writer는 해당 회차·과정·표시 관계를 읽으며 S2 배정을 판단 근거로 읽지 않는다. 같은 트랜잭션에서 S2 이전 값을 읽고 S1을 변경하는 역방향 의존성이 있어야 이 사례가 순환 반례가 된다.
- 감사 retention: `activity/retention.ts:4`와 `mongoRequestAuditRepository.ts:75`는 요청감사 30일/변경감사 365일 보존, 최대 1000건 삭제다. snapshot 뒤 생성 근거 삭제는 A→retention으로 설명할 수 있다. 삭제 이후 새 assignment는 생성 근거 누락으로 거절하는 기존 계약을 보존한다.
- 일반 PG writer 전체가 Serializable인 것은 아니다(`activity/database.ts`는 일반 write wrapper에 isolationLevel을 지정하지 않는다). 위 두 사례는 전체 PG/Mongo 동등성 증명이 아니며, 실제 엔진 동시 실행은 이번 읽기 전용 조사에서 검증하지 않았다.
- 후속 설계 후보: 공통 연결 검증/HMAC/상태 전이/changed rows 계산과 backend I/O를 분리하되 readState→토큰검증→변경→감사는 단일 transaction에 둔다. 일반 Operation repository 메서드의 반복 호출은 각기 별도 transaction이므로 대체할 수 없다.

2026-09-29 사용자 수락: 첫 Task는 port/CRUD와 접수 흐름 완결, Mongo context의 배정 preview/쓰기 차단, 실제 PG 기본 경로 유지. 배정은 후속 Task이며 새 schema/잠금정책은 금지한다. 아키텍처 조사는 종료했고 추가 조사는 하지 않는다. 다음 메타평가는 사용자 요청 후 이번 architect가 담당한다.
