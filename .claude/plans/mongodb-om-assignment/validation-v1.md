# Validation v1 — 독립 critic Aquinas
판정 S1 태그PASS,S2 Core3 PASS,S3 조건구체성FAIL. 결과기준은제안이며실행PASS아님. Plan2에서writer대응표/보호순서/재시도종료/unknowncommit처리조건확정필수. Core1조건표와fixture고정Shell분리.

## R1 원본 의미 동등성
원본fixture/새PG/Mongo 실DB대조. exact request/batch 생성metadata와회차중복/UUID/대표포함/삭제/일정수조건; 무관한같은과정회차제외;changes내용읽지않음.
동일clock/secret/snapshot은동일token. 서명request필드는id/team/status/assignedOm/operationId/totalSessions/sessions/createdAt(8개),operations id/operationId/roundNo/omName/omUserId/operationStatus/updatedAt(7개). batchID자체는서명하지않고확인시재검증;requestupdatedAt없으므로모든변경이력탐지주장금지.
expires<=now/>now+600000,형식/digest/actor/nextOm실패409,secret우선/fallback. 전체name/id교체·해제/DONE유지,같은requestOM이나회차다른경우실변경. 완전noop은operationIds[]/업무timestamp/감사/외부0,유효token반복허용.
사전선언한표현차만정규화. null/undefined/부재/배열순서/업무값삭제금지.

## R2 원자성 및 유효 직렬 순서
두번째회차/요청/감사실패전체rollback,이전감사보존,외부0. 실제독립session/native112/최신재시도·감사중복0. 요청edit/delete,회차edit/delete/restore,부분변경및완전noop,생성감사중복/다른request/추가회차phantom 양방향순서제어. 동일과정별도추가회차범위확대금지. 모두성공도유효직렬순서있으면허용하되barrier/응답/감사증거필수. synthetic throw만으로native통과불가.
unknowncommit은drivercommit재시도와callback재실행구분,성공미확정시rollback완료표시금지. 전체deadline재시도간공유(Plan2수치고정).

## R3 경계 및 실제사용계약
실route/authhelper/context/withActivity,인증공급·외부전송만통제. PG기본/scoped누락서비스쓰기전차단/동시중첩scope. team관리자유일이메일/override/명단중복실패거부,표시이름권한금지,자유입력OM신규등록요건금지.
401/403/400/404/409/200/안전500,no-store. 필요한각port누락:omAssignment/omRequests/teamUsers/operations/calendar/notifier/requestActivity. preview는읽기전용업무쓰기·ActivityChange·외부0이지만HTTPActivityRequest는기존best-effort로허용.
commit후변경회차만calendar,Slack nextOm있고이전requestOM과다를때만. 부수실패무rollback,driverretry중외부0,최종eligible1회(전역exactlyonce신규정책아님). driver/codec/calendar/slack민감error응답·로그노출0.
UI돌아가기쓰기0/중복PATCH차단/409token폐기/네트워크재시도보존. browser실행안되면미검증으로명시.

## 실행증거필수
기존CRUD실PG는assignment를검증하지않음. 새배정oracle에실privacy wrapper와SQLtrigger포함. 원본checksum/실PG/replica/일반writer/barrier112근거필수. 필수integration skip0 아니면미완료. architect writer대응표에검증연결필수.
