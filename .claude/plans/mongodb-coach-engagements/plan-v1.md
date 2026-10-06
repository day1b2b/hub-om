# Plan v1
1. [Core] 현행 의미 판독: 슬롯 생성은 평일 최대366일 및 09:00–18:00 기본시간. POST는 rating 생략400, PUT 생략허용. status fallback/취소 분기/날짜 PUT fallback을 보존한다. list DTO lowerenum/daystring와 write DTO upperenum/ISO 및 review partial/full response 차이를 보존한다. 일반 review의 rehire-only는 content history 없음.
2. [Core] 공통 직렬화: Mongo 내부 coordination 컬렉션에 coachId별 임의 nonce를 모든 범위 writer의 session에서 실제 갱신한다. business predicate 읽기 전 guard를 획득; engagementId→coachId 읽기는 guard 이전 필요하므로 같은snapshot에서 guard충돌시 전체tx재시도하고 다시읽는다. 기존 일정/예약/취소/engagement/평가가 같은 guard. guard 없어도 동작하는 fallback 금지. PG는 기존코치 advisory key를 공통 모듈로 추출한다.
3. [Core] engagement 생성/변경과 슬롯 교체·예약 cancelledAt/confirmedId·변경감사를 같은tx. review 변경/EDIT_HISTORY도원자화; 기존허용 감사필드/PII redaction/EDIT_HISTORY제외보존. 이력 물리삭제·새cascade 없음. 기존 슬롯 replacement만 보존.
4. [Shell] 계약/interface·PG/Mongo adapter·factory/context와 세route 연결. engagementApi는 순수변환/평일생성, 기존외부sync의 PG reservationAutoCancel compatibility유지. 외부sync뒤늦은잠금추가로역전deadlock만드는것금지.
5. [Check] 순수/PGmock, native 실제handler auth/DTO/기본값/취소상태분기/원자성/두 guard 순서 및 빈예약경합. requestPII/audit허용값/latecontentlog·audit실패rollback. 전체test/type/lint/build, 독립리뷰, docs/manifest/alignment/handoff/featurepush.

대안: 예약partialunique만으로는 빈predicate 경쟁 불충분. Coach업무updatedAt을mutex용으로변경하면 제품값을왜곡하므로 별도내부guard nonce 선택(사업schema필드추가없음). 외부sync 전체이관을 함께하면 coach보충·원천수집·physicaldelete정책이범위확대되므로 후속필수로분리. 생산전환은차단유지.
