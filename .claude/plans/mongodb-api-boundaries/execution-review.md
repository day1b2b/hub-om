# 독립 실행 검토

기준: plan-v2/validation-v2. 코드 검토자는 제품 코드를 수정하지 않았다. 이번 결과는 shadow 요청 경계 준비에 관한 것이며 운영 Mongo 선택·배포·전체 전환은 아니다.

## 현재 판정

확정 지적 1건(CoachManagement 초기화의 driver 오류 원문 노출)은 담당자가 일반화와 반례 테스트로 수정했고 소스에서 확인했다. 나머지 검토한 경로에서 확정 제품 버그는 발견하지 않았다. V10 추가 실패 주입과 최신 Mongo8 실행 결과를 확인했다. 코드·표적 통합·전체 회귀 및 종료 문서 검토는 통과다. 이번 변경의 최종 commit/push SHA 기록만 총괄 보관 절차로 남으며 코드 검토 차단 사항은 없다.

리뷰어 직접 실행: context / CoachManagement / Team facade / Team route 4개 테스트 파일 **10 pass / 0 fail / 0 skip**, `/tmp/hub-api-review-unit.log`. 이는 unit/mock이며 실제 PG query 대조가 아니다.

총괄 실행 Mongo8.0.30 증거: `mongoApiContext.integration.test.ts`와 `/tmp/hub-mongo8-api-native-final.log`를 직접 읽었다. 최신 묶음은 **30 pass / 0 fail / 0 skip, 19291.974584ms**이다. 여기에 TeamMember mock 4개도 포함되므로 30개 전부를 native라고 표현하지 않는다. Team의 팀 변경 감사는 PG의 공개 before/after 계약에 맞게 기대값을 수정했고 최신 묶음에서 통과했다. 이 리뷰어는 로그를 대조했으며 Mongo 실행 자체는 총괄이 수행했다.

`/tmp/hub-api-lint.log`는 오류 0·기존 경고 7, `/tmp/hub-api-build.log`는 정상 빌드 종료를 확인했다. `/tmp/hub-api-all-tests-final.log`에서 826개 중 814 pass / 12 skip / 0 fail을, `/tmp/hub-api-type-final.log`에서 typecheck 정상 결과를 확인했다.

## 코드와 반례 검토

- global ALS와 frozen shallow copy는 요청별 선택을 분리한다. 중첩·병렬·예외 복원 및 호출자 map 교체 반례가 있다. 인증 서비스를 context에 넣지 않으며 actor로 권한을 부여하지 않는다.
- missing scoped service는 throw하고 no-context만 PG/local을 선택한다. getPrismaClient는 privacy 설정 및 cache 접근 전에 차단한다. scope 이전에 외부에서 보관한 Prisma instance 자체까지 무효화하는 기능은 아니다.
- withActivity는 handler 전에 request recorder를 확인한다. recorder runtime 오류는 안전한 상수 메시지만 남기고 성공 응답을 유지하며 PG로 재시도하지 않는다. DATABASE_URL이 없어도 주입 recorder가 사용된다.
- 개인정보 서비스는 실제 세션 권한→감사 await→조회 순서다. native 통합 테스트는 비관리자 접근에서 감사가 없고 감사 insert 거절 시 private reader 호출 0회를 확인한다. export API는 아직 직접 PG이며 이 서비스 검증을 export 전환 검증으로 확대하지 않는다.
- Instructor save route의 requireWorkspaceSession 추가는 기존 proxy 밖에서 직접 호출돼도 쓰기를 막는 보완이다. native 실제 route 테스트가 인증 없음에서 Coach/Instructor 쓰기 0건을 확인한다.
- Coach/Team/Instructor 모두 mutation ActivityChange를 업무와 같은 session에 insert한다. Codec으로 actor/changes를 암호화하고 개인정보 diff는 redacted로 남긴다. 복합 PK/tag 제거·추가/private profile coachId 및 EDIT_HISTORY 중복 이벤트 제외를 확인했다.
- Team facade가 늦게 legacy adapter를 import하며 override 실패를 PG fallback으로 숨기지 않는다. Team 물리삭제 정책 차단은 유지한다.

## 추가 실패 주입 확인

Root native 통합에서 Coach detail PUT의 **후행 private-profile ActivityChange insert**를 validator로 거절한다. 이전 Coach 수정과 선행 Coach 감사 insert가 있었음에도 Coach/PrivateProfile 원본 문서 및 전체 ActivityChange 개수가 이전 값으로 돌아오는 것을 확인한다. Instructor save route도 InstructorNote 변경 후 ActivityChange를 거절해 HTTP 500 및 Note 원본 배열·감사 행 수 불변을 확인한다. Team의 ActivityChange 실패 후 업무행/guard 복원 반례와 합쳐 V10의 세 저장소 원자성 검증 gap을 해소했다. 별도 Coach suite가 tag join 삭제/생성, 복합 PK, profile PK 및 EDIT_HISTORY 중복 제외를 확인한다.

실제 Coach management native와 mock route 테스트는 서로 다른 증거다. 실제 auth guard+withActivity는 root native Coach POST/PUT 및 Instructor save에서, 나머지 메서드 DTO/route dispatch는 담당 mock 및 별도 native suite 범위로 구분한다. auth() 세션 공급은 합성 mock이며 실제 OAuth 로그인/E2E 브라우저 검증은 아니다. 표본 동시 실행은 모든 interleaving이나 운영 부하의 증명이 아니다.

## validation-v2 판단

| 항목 | 판단 | 근거 및 한계 |
| --- | --- | --- |
| V1 | 통과 | 실제 Coach route export dispatch와 DTO/HTTP 계약을 mock으로 대조, native 실제 POST/PUT 및 management suite 확인. 실제 PG query 비교는 미실행. |
| V2 | 통과 | 기존 Team facade/legacy 분리, override 조회·쓰기와 route 권한 반례. |
| V3 | 통과 | native Instructor save route가 주입 저장소에 쓰고 생략 필드 보존. |
| V4 | 통과 | 실제 workspace/PII guard + 합성 auth 세션, 무권한 업무 쓰기 0 및 접근 감사/조회 차단. |
| V5 | 통과 | privateAccess 서비스 검증이며 export/token/schedule의 직접 PG 잔여와 구분. |
| V6 | 통과 | global ALS의 병렬/중첩/예외 복원 테스트와 actor 권한 미부여 코드 확인. |
| V7 | 통과 | missing service 실패, cache 이전 PG getter 차단 및 호출 0회 반례. 사전 보관된 client를 무효화하는 보장은 아님. |
| V8 | 통과 | DATABASE_URL 없음에서도 Mongo request 기록, missing recorder 선차단, runtime 실패 best-effort/no fallback. |
| V9 | 통과 | PII 권한→암호화 감사→읽기, 실제 감사 실패에서 privateReads 0. |
| V10 | 통과 | Coach/Instructor/Team 신규 ActivityChange 실패 주입 후 실제 업무 rollback 및 암호화·redacted 감사. |
| V11 | 통과 | 총괄 실행 Mongo8.0.30 최신 묶음 로그 확인. mock4 포함한 30 pass를 전부 native로 세지 않음. |
| V12 | 통과 | 최종 전체 814 pass / 12 skip / 0 fail 및 typecheck, lint/build 로그 확인. |
| V13 | 통과 | 명시 내부 scope만 주입하며 공개 backend 선택이나 운영 자동 선택 없음. 이번 검토에서 운영 데이터/키 변경 없음. |
| V14 | 통과 | gap-plan 및 공개 운영 문서에서 export/token/schedule·Calendar/외부 동기화·Team 삭제·scan 한도·실제 복사/복구 gate를 유지함을 확인. |
| V15 | 문서 통과·보관 절차 대기 | manifest/alignment/handoff/gap-plan 및 공개 경계 문서를 확인했다. 최신 변경의 commit/push와 SHA 기록은 리뷰 통과 후 총괄 수행 예정이며 기존 원격 48b0f8b를 이번 변경 보관으로 오인하지 않는다. |

현재 남은 확정 제품 버그와 코드 검토 차단 사항은 없다. V1–V14 및 V15 문서 검토를 마쳤으며, 최신 변경 commit/push SHA 기록만 보관 절차로 남는다. no-context 운영 PG 기본값과 미전환 경로/실데이터·복구 gate는 유지한다.


최종 문서 대조: execution-manifest, gap-plan, alignment-review, handoff, docs/operations/mongodb-api-boundaries.md가 같은 scope와 수치를 사용하고 실제 handler/auth guard 검증을 OAuth/UI 검증과 구분한다. 이번 코드 준비 완료와 전체 PostgreSQL→MongoDB 전환 진행 중을 일관되게 명시한다. 운영 전환에는 아직 별도 실데이터/복구/전체 runtime 검증이 필요하다.
