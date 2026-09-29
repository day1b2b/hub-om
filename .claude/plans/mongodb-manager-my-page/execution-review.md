# 실행 검토 — 담당자 내 페이지

기준 bc77a12758bd060a4194b6489dd14c4eaa63074d. 명시 Mongo 검증 경계이며 생산 기본 PostgreSQL 유지. 전체 앱/운영 전환 완료가 아니다.

## 실행 결과

| 묶음 | 결과 | 근거 |
| --- | --- | --- |
| 일반 전체 | 878 pass / 28 skip / 0 fail | logs/unit.log, 실제 DB 환경변수 없이 실행 |
| 타입·빌드 | PASS | logs/typecheck.log, build.log, static exit0 |
| lint | 0 error / 기존 7 warning | logs/lint.log |
| 신규 manager 합동 | 31 pass / 0 skip / 0 fail | logs/manager-pg-parity-run.log; PG5 + native20 + page/factory6 포함 |
| 독립 PG/Mongo 비교 | 위 31 중 5 pass | 45 migration 적용, bc77a12 고정 predicate·수동 기대값·원문 저장 불변·동률 membership |
| timeout 보완 후 native | 21 pass / 0 skip / 0 fail | logs/manager-native-final.log; 기존20 + 오류주입1, final-test-typecheck/lint exit0 |
| 기존 포함 Mongo 전체 회귀 | 189 pass / 2 fail / 0 skip | logs/mongo-bundle.log; 부모+자식 동일한 기존 취소 테스트 순서 문제, exit1 |
| 해당 일정·예약 수정 후 재검증 | 14 pass / 0 fail / 0 skip | logs/schedule-fix.log; schedule-fix-typecheck/lint도 exit0 |

위 묶음은 중복되므로 합산하지 않는다. 전체 Mongo 191개의 단일 실행은 실패했으며, 테스트 정렬 수정 후 영향받은 14개만 재실행해 통과했다. 전체 묶음을 수정 후 한 번에 통과했다고 표현하지 않는다. 추가한 timeout 주입 검사는 전체 묶음 시작 뒤 추가되어 별도 native21 결과로 증명한다. 일반 skip 중 신규 세 DB suite는 별도로 실행했다. 기존 PG activity/courseRestore/admin-purge/privacy/source-ID, Calendar 잠금, 콘텐츠 PG비교는 이번 변경으로 재실행하지 않았으며 PASS로 계산하지 않는다. 모든 로그는 /private/tmp/hub-om-manager-20260929/logs 아래에 보관한다.

## 기준 연결

- M1: 실제 page/admin guard로 미인증·외부도메인·비관리자 거부, 승인 세션 email 사용, searchParams identity override 불가, 빈 props·과정분류.
- M2: factory 기본PG/명시 누락실패/병렬·중첩. exact 예약 이메일과 normalized 명단 이메일 구별, HMAC 확인, 기존 이름 원문 contains→split→normalize.
- M3: 실제 중간 writer 변경에도 각 메서드 snapshot 유지. null link 제외, nonnull dangling·필수 coach 손상은 Mongo 실패. 페이지 두 조회 사이 원자성 미보장.
- M4: 실제 PG/고정 DTO 대조로 예약 coach 우선·중복제거·deleted 포함·상태·평가·빈값·슬롯·기간·정렬·UTC오늘 분류 보존. 모든 5모델 125행 조회로 다중 페이지 확인.
- M5: raw 저장 암호화·HMAC/암호문/키변조 거부·오류 원문 비노출. oversized 실제 문서 scan 실패. 두 메서드의 첫 실제 예약조회 후 SCAN_TIMEOUT 오류주입으로 부분 응답 금지. 공통 store.scan 시간한도는 콘텐츠 suite의 실제 마지막 cursor close 이후 가상시계16초 이동 검사에 연결한다. 실제 네트워크 30초 지연·부하보장은 미검증.
- M6: 실제 PG45 migration/양저장소/독립 기대값 비교, 최종 static PASS. 전체 Mongo의 실패 원인 수정 후 영향 범위 재검증 PASS. 독립 리뷰 차단 지적 없음. 원격 인계는 handoff.md와 종료보고에서 구분한다.

page 테스트의 Prisma getter mock은 호출감지다. 실제 PG 차단은 기존 dataRepositoryContext.test.ts·mongoApiContext.integration.test.ts 근거를 별도로 따른다. 실제 auth guard를 실행하며 OAuth 세션 공급과 자식 UI만 합성 대체했다.

## 독립 리뷰

Gibbs: 초기 P0/P1 없음, P2 page 테스트 implicit-any 수정 필요, P3 validation-v2 문서 참조 및 timeout 증거 요구. 타입 수정과 최종 typecheck 통과, 문서·오류주입·공통 시간한도 근거로 보완했다. 최종 코드·증거 검토에서 새 차단 지적 없음.

기존 취소 테스트는 자연 순서의 두 번째 UUID를 실패 대상으로 골랐지만 store.scan은 _id 오름차순이라 실제 첫 감사가 거부될 수 있었다. 테스트 관측도 simple collation/_id asc로 정렬해 실제 두 번째 감사가 거부되도록 했다. 첫 감사 실행·전체 rollback·기존 이력 보존·500 요청 기록·재시도 성공 assertion을 모두 유지했다. Gibbs는 이 수정과 14pass 로그를 독립 확인했고 검증 약화가 아니며 전체 재실행 추가 요구가 없다고 판정했다. 생산 일정/예약 코드 변경은 없다.

소유 Mongo 경로·복제본 이름을 확인하고 잔여 합성 DB 0을 확인한 뒤 Mongo/PG 정상종료, 정확한 두 dbpath 삭제 완료. logs/cleanup.log 보관. 첫 cleanup은 이름 응답필드 검사 오류로 변경 전에 중단했고 hello.setName 검사로 고친 다음 성공했다.

## 한계

OAuth 실로그인·브라우저 전체 시각검사·실운영 규모·모든 collation/동률·운영Atlas·실데이터복사/복구·키rotation 미실행. 기존 동명이인 이름기반 과정 중첩을 새로운 identity/권한정책으로 바꾸지 않았다. Mongo 전체문서 scan은 PG 선택컬럼보다 byte 한도에 먼저 닿을 수 있다. token backfill·다른 기능군·브라우저초안 암호화·운영이전·dev→main은 미완료/미실행.
