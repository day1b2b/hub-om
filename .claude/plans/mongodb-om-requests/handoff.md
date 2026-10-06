# OM 요청 첫 단위 인계

Initiative: PostgreSQL→Mongo 병렬전환 및 개인정보암호화. Macro ../mongodb-read-repositories/macro-plan.md.
Wave: 기능별경계 전환/합성검증. Task: OM접수·조회·수정·삭제. RigorLevel3(R1~6=6).
현재위치: feature/20260929-mongodb-om-requests,baseline383d804. Lifecyclecompleted,Artifact검증·독립수락·제품원격통합완료. 제품908175b,후속문서HEAD는integration-review참조.
마지막완료: 실제PG69관찰×3backend/OM31pass/일반916pass60skip/Mongo590pass/typebuild/lint0error7기존경고,소유합성정리. execution-review 참조. 겹치는test숫자합산금지.
Validation: 원본접수부분성공/메타보존/요청만물리삭제·operation유지/권한/저장비노출을실handler/page및원본PG와대조. 브라우저아님.
열린gap: 이번단위없음. 배정전체는다음단위.새사용자결정없음.
Alignmentupdate_task_scope. 이Task와후속배정Task분리. 운영문서docs/operations/mongodb-om-requests.md.

## Do Next
1. 이번단위완료. integration-review에서원격제품SHA와최종문서기록확인.
2. 다음기능은OM배정: docs/operations/assignment-confirmation-integration.md 및실omRequestAssignment/route/AssignForm 기준. PG현재서명·권한·정확한생성batch/전체회차(수동name/id포함)확인후변경·취소/DONE유지정책보존. 실제PGoracle/Mongo/handler/동시배정·일반writer경합·부분failure/auditrollback 검증.

## Do Not
운영DB/실원천/원본workspace/키/env/권한/배포/main/dev수정금지. 이담당에서automation설정변경금지(총괄의ACTIVE/PAUSED실제상태를뜻하지않음). 이번Mongo배정은4진입점명시차단. 옛samecourse helper를새배정정책으로되살리지말것. 연결근거없는과거요청임의수리/확대금지. 기존namespace자동삭제수리금지. 완성검증을반복하지말고새변경/실패범위만재검증.

재개순서: handoff→execution-review→최종review→integration-review(준비후)→plan-v2/validation-v2→coverage/macro.
Resume action: start_next_task (OM 전체 배정).
