# Plan v2

확정 범위(2026-09-29 사용자 수락): 첫 Task는 port/CRUD와 접수 흐름 완결이다. 배정은 후속 Task로 분리한다. 명시 Mongo context의 preview/assignment 진입점은 미지원으로 차단하고 실제 PostgreSQL 기본 경로는 그대로 유지한다. 이번 문서 갱신은 구현·DB·원격 실행 승인을 추가하지 않는다.

핵심 난이도: 요청 저장과 best-effort 회차 연결·도구·알림·메타 저장의 기존 성공/부분실패 계약을 유지하며 backend I/O를 분리한다.

1. [Core] 원본 계약 동결. 원본Local/PG repository와접수handler를 fixture로 고정. 접수는 요청create→연결회차개별create/patch→customtools→Slack→meta 각 best-effort, 실패접수는500, 후속실패는201. 재접수는 기존처럼 새 요청이며 idempotency를 추가하지 않는다. 수정은 입력field만, 메타는 truthy값만. 삭제는 요청만 물리삭제, 회차유지. PG/local 기본동작 유지.
2. [Core] 후속 배정 Task의 기준(이번 구현·추가조사 제외): 기존existing team/assignedOm/operationId와 최신request일치, sessions/date/count검증. 생성ActivityChange의 POST /api/om-request batch에 정확히 request1개+서로다른N회차(UUID)와 대표회차가 있어야 함. 이름/과정으로 확장하지 않음. preview 10분token은 actor/nextOm/request관련값/회차updatedAt에 묶임. snapshot에서 토큰과 근거가 일치하지 않으면409. 확인성공이면 모든근거회차 omName=trim(nextOm)/omUserId=null, NEEDED↔PLANNED만 전이, 나머지상태유지. 요청+회차+감사 한transaction에서 changed rows만 쓴다. snapshot 이후 요청 sessions/no-op 회차의 독립 수정은 A→writer로 직렬화 가능하므로 무조건 충돌로 취급하지 않는다. Mongo snapshot과 PG Serializable 전체 동등성은 미입증이며 후속 Task에서 실제DB로 검증한다. 새 schema/잠금/write-fence는 추가하지 않는다.
3. [Shell] 저장 interface/factory, PG/local adapter, Mongo CRUD 구현. assignment facade는 명시scope에서 미지원오류로 차단하고 PG기본은 원본그대로. 암호화/HMAC/validator 계약 재사용. Mongo replica+shadow gate, 누적deadline, 드라이버내 재시도, 외부오류는고정메시지. OmRequest 감사PG allowlist 일치. runtime/snapshot/schema 변경은 필요없음.
4. [Core] 실제 API와 page가 쓰는 기존facade 유지. 명시 context에서 operation·omRequest·customTools·접수 notifier services 먼저 확보하여 누락이면 업무/외부효과0. 기본PG/local은 기존API/권한/부수작업동작 유지. 보호된 정보는 허용응답에만 복호화, 로그/오류에 원문금지. 도구파일·Slack·calendar 실원천은 주입합성port로 차단.
5. [Check] 실제로컬PG 원본oracle vs 새PG/Mongo 반환값/행/감사/상태/재실행 비교. native Mongo CRUD와메타동시수정, 접수부분실패·단일업무감사실패rollback; 배정은scope차단, wrongkey/corrupt, 누락scope·실handler권한/로그/알림을 검증. 일반test,전체Mongo묶음,type/lint/build와 독립리뷰. 미실행검증 PASS 금지; 새변경없는 검증반복금지.
6. [Shell] coverage/macro/실행/인계 기록, 소유합성DB정리. 승인된 feature commit/push 및 총괄FF통합,원격SHA일치. dev/main/운영전환 제외.

대안: 배정전체DB알고리즘복제는 drift위험으로 배제; shared 순수검증+각 backend IO 선호. 접수와 모든부수작업 단일transaction은 기존부분성공정책 변경이라 배제.
수락: 단계1-4 위의 조건에 대해 실제관찰증거,5실행통과 및 독립수락,6원격/정리/남은범위문서.

최종경계: 배정알고리즘/캘린더모듈/AssignForm은 구현제외; 배정진입점은PG우회0검증. 서버page render는실제데이터경계,UI leaf합성. 브라우저화면/인증proxy전체/외부알림실송신은미검증표시.

아키텍처 조사 종료: 추가 조사 없이 이 범위로 계획을 평가한다. 다음 메타평가는 사용자 요청을 받은 뒤 이번 architect가 담당하며, 현재는 시작하지 않는다.

## 구현 확정 계약
port OmRequestRepository는기존함수명메서드(list/get/create/update/delete/setOperationId/setSlackMeta)유지. DTO mapping공유,legacyPG/local원본IO보존. updateOmRequestAssignment helper 및 preview/confirm은scope에서명시거부하고PG원본유지.
명시context키 omRequests/operations/omCustomTools{list,add}/omRequestNotifier{notifyCreated};withActivity기존requestActivity. POST는모두save전확보. PATCH는도구port+repository save전확보.DELETE는repository만. page기존helper가명시context읽기. getTeamMemberRepository scope는stored명단에연결해원천fallback없음. 기본호출기존그대로.
Mongo create는requiredinput/defaultN/nullablefields,update는undefined무시+입력nullable null정규화;메타/대표값patch는최신row로암호화하고지정필드+companion만update. delete는요청만삭제. 각transaction내원자감사. 30초누적deadline 및driver동일transactionretry,catch고정오류.
사전허용차: UUID/생성시각은형식·참조관계정규화,동일createdAt의순서PG미지정. 기본local id/time/저장순서기존유지. 외부오류원문→고정로그는비노출요구의의도적변경. 요청감사runtime실패는업무성공. PG암호화JSON동일값은트리거redacted감사발생여부실DB기준으로판정.
Changelog: 첫단위분리,실패지점별상태·호출관찰,barrier경합과허용결과,누적deadline/감사귀속/긍정대조군 명시. 기술정책새결정없음.
