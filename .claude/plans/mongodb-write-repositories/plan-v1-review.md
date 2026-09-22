# 독립 계획 검토 — v1/v2

검토자는 구현 제품 코드를 수정하지 않았다. `clarify-result`, `plan-v1`, `validation-v1`, `meta-evaluation`, `validation-v2`, `plan-v2`와 기존 Coach API·TeamUser·PrismaInstructorNote 계약을 대조했다. 파일명은 요청된 `plan-v1-review.md`이며 최신 판단 대상은 v2다.

**판정: v1은 검증 기준 부족, v2는 방향 적합하나 아래 R1의 계약 충돌을 명시적으로 정리해야 최종 완료 판정이 가능하다.** TeamUser guard 직렬화는 총괄이 승인한 shadow 내부 contract로 인정한다. 물리삭제 차단은 기존 API 동등 구현 완료로 세지 않고 전환 gap으로 남긴다. native 실행 증거는 아직 이 검토에 제공되지 않았으므로 runtime PASS 판정은 하지 않는다.

## 구조·결정성·변별력·추적성

| 기준 | v1 | v2 | 독립 판단 |
| --- | --- | --- | --- |
| S1 Core/Shell/Check 태그 | 충족 | 충족 | 실행·연결·검증 분리 |
| S2 Core 1개 이상 | 충족 | 충족 | 기존 계약 mapping과 transaction/guard/부분 저장이 실제 Core |
| S3 입력별 결정 가능성 | 부족 | 부분 충족 | Instructor get(name) null 우선/save(name) null-last는 명확. Coach의 기존 parse 유지와 V5의 모든 잘못된 날짜 실패는 충돌(R1) |
| 반례 변별력 | 부족 | 대체로 충족 | 평문 저장, no-op mock transaction, 경쟁 중복, 준비 없는 연결, 잘못된 완료 선언을 탈락시킬 기준 있음 |
| 재현성 | 부족 | 보완 필요 | 합성 native와 mock 구분은 명시됨. 최종 evidence에는 실행 명령·대상 버전·pass/fail/skip·반례 입력/실제 출력 필요 |
| 추적성 | 부족 | 부분 충족 | 계획 단계와 검증 번호의 직접 mapping을 아래 표로 보완. 구현 파일/로그 연결은 최종 manifest에서 필요 |

S3의 R1을 미정으로 둔 채 결과 15개를 모두 PASS로 표시해서는 안 된다. 그 외 독립적으로 진행 가능한 구현/검증을 멈출 이유는 없다.

## R1 — 날짜·잘못된 입력의 동등성 기준 충돌

`plan-v2` 1번은 기존 Coach API parse/trim/status/date 계약을 유지한다. 그러나 `validation-v2` 5번은 “잘못된 입력/날짜 … 실패”를 일괄 요구한다.

기존 `src/app/api/coaches/[id]/route.ts`의 `dateValue`는 빈 문자열·형식 불일치 문자열을 **null로 변환**하며, PUT은 그 결과를 저장한다. status 미인식값도 해당 PUT에서 ACTIVE로 대체한다. 날짜 형식이 맞지만 달력상 존재하지 않는 값은 JavaScript Date 정규화 또는 DB 거부 여부에 따라 별도 동작한다. 따라서 “모든 잘못된 날짜는 예외”를 구현하면 기존 동등성 기준과 동시에 충족할 수 없다.

보완: 검증 5번을 다음처럼 입력 종류별로 구분한다.

- 기존 허용/정규화 입력: 예를 들어 optional date `""`, `"not-a-date"` → 기존처럼 null. 누락 입력은 기존 값 유지.
- 기존 거부 입력: 필수 이름 공백, 실제 저장 불가능한 값/Date, 암호문 변조 → 안전한 실패 및 관련문서 전부 미변경.
- 만일 더 엄격한 날짜/상태 정책을 의도한다면 “기존 동등성”과 분리해 승인된 변경 및 호출부 영향을 기록한다. 검토자가 임의로 정책을 선택하지 않는다.

## 추가 판정 주의

- TeamUser의 기존 `updateTeamUserTeam`은 DB 오류까지 catch→null 처리한다. native가 부재만 null, 암호화/DB 오류는 fail-closed로 구분한다면 이를 보안상 의도한 차이로 기록해야 한다. 단순 “기존 반환 의미 동일”이라고 보고하지 않는다.
- V13의 schema 불변은 **PG Prisma schema/migration 및 업무 모델** 기준으로 명시한다. 승인된 Mongo guard 컬렉션·validator/index 준비는 새로운 내부 저장 계약이므로 “어떤 schema도 바뀌지 않음”이라는 표현은 부정확하다.
- InstructorNote get(name)의 null NO 우선과 save(name)의 null-last는 서로 다른 기존 동작이다. 이를 하나로 정리하는 refactor는 이번 범위에서 하지 않는다. 같은 이름·NO 조합의 tie가 원래 미정이면 임의 결정성을 기존 보장으로 주장하지 않는다.
- 복수 동시 부분 수정은 read-modify-replace stale overwrite를 드러내는 barrier 또는 실제 경합 fixture가 필요하다. 순차 두 번 저장은 동시성 증거가 아니다.
- TeamUser guard는 **신규 repository writer끼리만** 유효하다. 기존 직접 API/외부 writer를 막는 생산 cutover gate가 없으면 전체 앱의 이메일 유일성을 보장했다고 할 수 없다.

## 검증 15개 검토와 반례

여기서 “적합”은 검증 기준으로서의 적합성이다. 구현 실행 결과는 모두 별도 증거가 필요하다.

| V | 계획 연결 | 기준 검토 | 탈락시켜야 할 반례/필수 증거 |
| --- | --- | --- | --- |
| 1 | Core Coach | 적합 | profile/tag 갱신 실패 뒤 Coach만 남음; 공개 DTO에 개인 프로필/토큰 원문 속성 포함 |
| 2 | Core Team | 적합·차이 명시 | `" A@EXAMPLE "`와 `"a@example"` 경쟁 중복; null team/role 출력 차이 |
| 3 | Core Instructor | 적합 | 같은 이름의 null/번호 행에서 get/save 선택을 같게 구현; omitted 값을 null로 덮어씀 |
| 4 | 각 Core | 적합 | 없는 수정 대상이 생성됨; 삭제 Coach가 일반 수정됨; Instructor 명시 upsert는 예외로 분리 |
| 5 | Core Coach/공통 codec | **R1 수정 필요** | 기존 null 정규화와 엄격 실패 충돌; 잘못된 암호문 후 부분 저장 |
| 6 | 각 Core | 적합 | raw native insert/replace로 PII 평문 저장; 오류 메시지에 값/키/URI 노출 |
| 7 | Coach transaction/Instructor patch | 적합 | 중간 단계 fault 이후 잔존문서·audit 또는 경쟁 patch 유실. 실제 엔진 필요 |
| 8 | Team guard/Instructor unique retry | 적합 | 동시 이메일 생성 둘 다 성공, 동일 NO 중복, 다른 NO 충돌을 성공으로 삼음 |
| 9 | Shell 준비 | 적합 | standalone/준비 없는 namespace/잘못된 DB/writegate 없이 쓰기; open 자체 DDL |
| 10 | 공통 암호화 | 적합 | 구키 제거·AAD/HMAC/필수 companion 변조 뒤 데이터 쓰기; 오류 후 정상 복원 불가 |
| 11 | Check 전체 검사 | 적합 | 테스트 미실행/skip을 pass로 합침. 명령·exit code·경고 별도 기록 |
| 12 | Check native | 적합 | 실운영 URI 자동 사용; mock withTransaction 성공을 native rollback 증거로 사용 |
| 13 | Shell 경계 | 적합·용어 보완 | factory/routes·PG schema·키·운영 데이터 변경. 승인된 내부 guard 예외 명시 |
| 14 | inventory/handoff | 적합 | Team 삭제를 무조건 성공/0으로 숨기거나 전체 전환 완료로 표시 |
| 15 | 독립 리뷰/manifest | 적합 | 독립 검토와 실행근거 없이 작성자 완료 선언; shadow 구현을 배포 완료로 표현 |

## 최종 실행 리뷰 인계

R1과 위 의도한 차이를 계획/검증 기준에 반영한 뒤, 각 구현 파일과 표적/native 로그를 받아 V1–V15를 pass/fail/not-run으로 평가한다. 실패가 발견되면 실제 입력·기대 결과·실제 결과·파일을 기록한다. inventory는 `docs/operations/mongodb-runtime-coverage.md`에 남겼으며 이번 세 write repository를 생산 미연결/진행 중으로 구분했다.
