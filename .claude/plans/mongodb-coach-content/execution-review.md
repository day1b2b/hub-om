# 실행 검토 — 코치 콘텐츠 경계

기준 e1b97490, feature/20260929-mongodb-coach-content의 신규 변경. validation-v2 및 그 명시적 한계에 따른 판정이다. 이전 9/23의 결과를 재사용하지 않았다.

## 검증 환경과 최신 결과

- Node24.19.0 / PG17.9(C) / Mongo8.0.30 replica set. env-i, loopback, 합성 fixture·임시 키.
- 일반 test: 877 pass / 25 skip / 0 fail. skip은 외부 DB URL을 제공하지 않은 opt-in integration이며 통과로 합산하지 않는다.
- typecheck/build 통과, lint 0 error / 기존 7 warning. 마지막 sheet assertion 변경 후 typecheck 추가 확인.
- 실제 PG/Mongo 비교: 7 pass / 0 skip / 0 fail. 모든 45 migration/감사trigger, 305행 feed·CRUD·월현황·감사 parity와 큰 문서 BSON 짧은페이지 대조.
- 실제 콘텐츠 handlers: 6 pass / 0 skip / 0 fail. 실제 guard/withActivity/admin server page 실행, OAuth 공급과 자식 UI만 합성 대체.
- 전체 Mongo 회귀: 165 pass / 0 skip / 0 fail, 종료코드0. mock TeamMember 4개 포함, 일반 테스트 및 신규 PG 검사와 합산하지 않는다. 앞선 실행 163pass/2fail(시트 assertion 및 parent)은 공유 keyset의 마지막 빈 페이지로 달라진 관측 검증을 보완한 후 해소했다.

## 기준별 근거

| 기준 | 근거·현재 판정 |
| --- | --- |
| V1 | factory test 기본PG/누락/병렬·중첩, handler audit scope 누락, 기존 중앙 PG guard 회귀 PASS |
| V2 | actual handlers와 real PG fixture 입력/작성자/DTO/삭제메모·이력 대상 계약 PASS |
| V3 | 각 메모연산 history/audit 후행 오류 rollback, 정확한 이력/감사, real PG trigger parity PASS |
| V4 | 4연산×purge 양방향, 최초 guard 충돌, 토글 및 본문/토글, retry exhaustion PASS |
| V5 | namespace/guard/validator/index readiness 거부·자동수리없음 PASS |
| V6 | 301/305행 300상한·null/빈후기·삭제코치·동률·BSON 짧은페이지 PASS |
| V7 | real PG 및 handlers ACTIVE/미삭제/isActive false·다른월·3상태·URL encoding PASS |
| V8 | actual page admin/redirect 선행/count/배열tab/default/scope 누락 PASS |
| V9 | actual withActivity actor/requestId/status 연결·기록실패성공유지·고정오류 PASS |
| V10 | raw 저장 평문 없음, HMAC/암호문·키 오류, DTO companions 제외 PASS; 기존 private-access 보호 포함 전체 Mongo 165pass |
| V11 | 45 migration 실제 PG 및 고정 baseline predicate/DTO와 Mongo 비교 PASS. 생성ID/시각만 제한 정규화 |
| V12 | 일반/type/build/lint 및 Mongo 165pass. 독립 최종 증거 검토 PASS |

## 독립 리뷰

Gibbs가 전체 diff와 검증을 읽고 P1(getMore), P2(다중페이지 테스트), P2(15초 초과 마지막페이지 성공)를 지적했다. 공개 singleBatch/keyset, 실제 명령·BSON page 검증, page close후 기한 검사로 보완했다. 최종 독립 판정 PASS, 신뢰도 높음. Mongo165/PG7/일반877과25skip/type/build/lint 및 명시한계를 확인했고 미해결 코드 차단 지적 없음. 기능완료와 인계·운영전환은 구분한다.

공통 근거는 기존 dataRepositoryContext.test.ts의 cached getter 차단·scope격리, 이번 coachContentRepositoryFactory.test.ts의 실제 getter 차단, mongoApiContext.integration.test.ts의 개인정보 감사 실패시 접근차단에 연결한다. 콘텐츠 handler 테스트의 Prisma getter는 예상치 못한 호출을 감지하는 mock이며 그 자체가 실제 Prisma guard 검증은 아니다. 실제 auth guard/withActivity는 실행하고 세션 공급만 합성 대체한다.

## 한계

실제 OAuth/브라우저 전체 시각회귀/운영Atlas/운영 데이터복사·복원/부하/키rotation은 미실행. PG collation과 모든 문자열 정렬 및 동률300번째 선택은 동일성을 보장하지 않는다. 기존PG 동시성 결함 수정은 범위 밖이다. 15초 이후 결과성공을 거부하나 진행중 요청의 취소시각은 tx CSOT이므로 정확15초응답을 보장하지 않는다. 전체 앱/브라우저초안/운영데이터 암호화·이전 미완료.

일반25skip 중 이번 범위의 신규PG 비교와 Mongo suite는 위 별도 실행으로 검증했다. 기존 PG activity/courseRestore/admin-purge/privacy/source-ID 및 Calendar 잠금 integration은 이번에 별도 재실행하지 않았다. 해당 미실행을 PASS로 처리하지 않으며 기존 결과로 대체하지 않는다.

실행 명령·로그: /private/tmp/hub-om-content-20260929/checks.sh static / mongo, logs/{unit,typecheck,lint,build,mongo-bundle,content-parity-run-1}.log. 최종 feature commit/push/원격확인은 종료보고와 branch ref에 연결한다. 소유 synthetic Mongo 잔여DB 0 확인, Mongo/PG 정상종료 및 dbpath 삭제 완료. 실행파일·검증로그 보관.
