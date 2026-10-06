# OM 요청 CRUD·접수 전환 — 첫 Task 확정

기준 383d804fb8cbe94ec7a0908cc8bc986714d11178, branch feature/20260929-mongodb-om-requests. clean clone 재사용. 원격 총괄 동일, dev307f52f 관찰만.
실행 승인: 기존 계속 진행 범위. 운영/실원천/키/env/권한/배포/main/dev/원본workspace 금지. 새 의존성·업무필드·삭제·잠금정책 없음.
R1~R6 모두 해당(다중파일/계약분리/실PG 의미/사용자위험/회차·권한검증/인계): Level3.
목표: 기존 요청 CRUD와 접수→회차연결·도구·알림·메타 저장의 명시Mongo/기본PG 경계. 접수 완결은 기존 best-effort 부분성공 정책까지 보존한다는 뜻이며, 모든 부수작업의 원자 성공을 뜻하지 않는다. 성공은 실제DB·handler·원본대조·독립검토·원격통합. 전체운영전환과 Mongo 배정은 미완료.
현행 delete는 OmRequest 물리삭제이며 연관 operation 유지. 새 삭제정책을 만들지 않고 기존 계약을 보존한다. 신규 사용자 결정 없음.
읽기 오류: clone AGENTS.md 없음(사용자 제공/상위지침 적용); 추측한 mongoRuntimeStore/mongoActivityChange 경로 없음→실제 mongoOperationStore/mongoOperationAudit를 rg로 확인. 변경/실행 영향 없음.

2026-09-29 사용자 명시 수락: 첫 Task는 port/CRUD+접수 완결로 확정한다. 명시 Mongo context에서 배정 preview/쓰기 진입점은 미지원으로 차단하고 PG fallback은 금지한다. 실제 PostgreSQL 기본 경로는 현행을 유지한다. 배정전체·서명·경합은 후속 필수 Task로 분리한다. 이유: 접수부분성공과 배정원자확인은 독립실행/검증가능하며 한번에바꾸면 검토범위가커짐. 새 schema/잠금정책은 금지하며 신규 열린 결정은 없다.

아키텍처 조사는 종료했다. 추가 조사와 구현은 이번 문서 갱신 범위에 없다. 다음 메타평가 요청이 오면 이번 architect가 담당한다. 문서 갱신으로 DB·원격 실행 권한을 추가하지 않는다.
