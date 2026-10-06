# Validation v1 — 독립 검증 기준 15개

판정은 구현자 설명이 아닌 코드·fixture 기대값·실행 로그를 근거로 한다. 미실행은 통과가 아니다. 동일 fixture의 PG reference가 실제 DB 실행인지 mock인지 구분한다. 명시된 계약 변화가 필요하면 v2 계획에서 이유와 회귀 기준을 먼저 갱신한다.

## 호환성 5개

- V1 Team resource owners: active/role null 필터, sourceTeam null 제외·UNKNOWN 분류, displayOrder와 이름 순서, 빈 결과 default를 기존 Prisma 출력과 비교한다. 순서 있는 배열까지 같아야 한다.
- V2 Team role rosters: role 있는 TeamUser만 사용하고 팀 1/2/미분류와 ld/om 분류를 보존한다. 전체 빈 목록 default와 LD만 있을 때 OM default 보완을 따로 검사한다. 정상 빈 결과와 오류 fallback을 혼동하지 않는다.
- V3 Coach summary/detail: 목록의 deletedAt 제외와 상세의 기존 조회 정책 차이, null rating 제외 평균·취소 제외 고유 근무일, 분야/커리큘럼·URL·archive 최신 completed/public/coaches fallback을 각각 검사한다. null과 빈 문자열 fallback도 일치해야 한다.
- V4 Coach 일정/engagement/dashboard: 기존 정렬, 날짜 range 양끝, cancelled 및 삭제 필터, 월말/연말 경계, 중복 날짜, 가용 시간·예약/업무 중첩 bitmap과 상태를 동일 fixture 기대값으로 비교한다. listSchedules와 listEngagementSchedules의 정책을 통합해 바꾸지 않는다.
- V5 Private 조회: profile 없음→null, nullable 필드와 birthDate 날짜 문자열, feedback의 startDate desc/id asc를 보존한다. 일반 DTO에 private profile/hiredByText/암호화 companion이 추가되지 않는지 필드 allowlist로 검사한다. 기존 공개 feedback/coachInputUrl 계약은 별도로 유지한다.

## 암호화·격리 5개

- V6 새 repository는 명시적 client+허용 shadow database+namespace로만 열린다. 허용되지 않은 DB/namespace와 불완전 store 준비를 거부한다. 기존 PG/local factory 선택 diff가 없어야 한다.
- V7 실제 저장 문서는 runtime codec 암호문/AAD/HMAC을 만족한다. 잘못된 key·AAD·tag·필수 companion은 실패하고 평문 fallback·부분 결과·기본 roster 대체를 하지 않는다. 구키 읽기도 검증한다.
- V8 평문 fixture PII가 raw Mongo document/키/로그/오류/증거 파일에 노출되지 않는다. 승인된 반환 DTO에만 복호화 값을 포함하며 private profile와 archive 원천 전체 객체를 외부 DTO에 붙이지 않는다.
- V9 조회 메서드는 insert/update/delete/collMod/createIndex를 실행하지 않는다. setup은 총괄 소유 별도 단계다. DB/namespace 간 동명 ID의 레코드를 서로 읽지 않는지 독립 namespace fixture로 검증한다.
- V10 후보 조회·관계 조회·복호화 정렬의 상한과 오류 동작을 명시한다. 한계 초과 시 조용한 잘라내기 금지. 다중 collection 결과를 snapshot으로 보장하는지 또는 어떤 동시성 한계가 있는지 기록하고 PG 이상의 보장을 근거 없이 주장하지 않는다.

## 실제 synthetic 회귀 5개

- V11 실제 허용 synthetic Mongo에서 암호화된 Member/TeamUser fixtures를 넣고 두 roster 메서드를 실행한다. empty/default·미분류·역할 조합과 정렬 검증을 포함하며 결과는 V1/V2 기대값과 같아야 한다.
- V12 실제 synthetic Mongo에서 Coach의 6개 메서드를 모두 실행한다. 분야/커리큘럼 연결, 평균 rating, 월별 일정·예약·engagement 및 archive fallback을 최소 한 번씩 실제 collection 조회로 검증한다.
- V13 실제 synthetic Mongo에서 두 private 메서드의 null/날짜/feedback 결과를 검사하고, key/AAD 또는 저장 암호문 변조가 실제 조회에서 실패하는지 확인한다. 테스트 후 합성 namespace만 정리한다.
- V14 PostgreSQL 기준 구현의 관련 회귀를 유지하고, 동일 합성 fixture에 대한 두 adapter DTO 비교 근거를 남긴다. full test/lint/typecheck/build 결과와 기존 경고·DB skip을 분리한다. store 모델 확장으로 기존 MongoOperationRepository 생성/수정/재시도 동작이 깨지지 않아야 한다.
- V15 실행 전후 생산 factory·PG schema/migration·환경 키와 기존 데이터가 바뀌지 않았음을 변경 범위로 확인한다. 합성 namespace setup/정리만 허용한다. 실제 데이터 복사 job·운영 연결 검증·Mongo 전체 runtime/cutover는 별도 미완료로 명시한다.

독립 리뷰는 V1–V15에 대해 pass/fail/not-run을 표시하고, 실패는 구체 입력·기대값·실제값 및 경로/라인을 남긴다. v1은 기준 초안이며 구현 전 총괄 v2 확정 대상이다.
