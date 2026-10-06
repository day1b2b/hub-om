# 독립 실행 검토 — Mongo read repositories

검토 기준: validation-v2 V1–V15. 2026-09-22 현재 미커밋 구현을 읽기 검토하고 표적 테스트를 직접 실행했다. 제품 코드는 수정하지 않았다. 재현 가능한 기능·보안 차단 결함은 발견하지 못했다. 최종 판정은 **한정된 조회 repository 구현 범위 V1–V15 pass**이며, 실엔진 증거는 MongoDB 7.0.43 합성 환경에 한정한다. 운영 MongoDB 8.0 검증·실제 데이터 복사·생산 factory 전환은 완료 범위가 아니다.

## 직접 실행한 검증

Node 24의 `--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test`로 다음 다섯 파일을 실행했다: mongoCoachRepository.test.ts, mongoCoachRepository.integration.test.ts, mongoReadStore.test.ts, mongoTeamMemberRepository.test.ts, shadowJobCommand.test.ts. 결과는 **10 pass / 0 fail / 2 skip**이다. Skip은 새 Coach와 Team 실제 Mongo 검사다.

Coach 비교는 기존 PrismaCoachRepository/PrismaCoachPrivateRepository 코드를 호출하되 Prisma delegate를 합성 fixture로 대체한 **mock reference 비교**다. Mongo 측에는 실제 codec 암복호화를 사용하지만 store 조회와 readiness를 mock 처리한다. 따라서 실제 PostgreSQL 쿼리·Mongo validator/index/filter 실행 검증을 대신하지 않는다. Team 역시 Prisma delegate를 mock한 비교다.

## 항목별 판정

| 항목 | 판정 | 근거와 남은 범위 |
| --- | --- | --- |
| V1 | pass | mongoTeamMemberRepository.test.ts의 역순 fixture와 inactive/role/null-team, displayOrder/name 정렬 비교. 기존 privacy proxy의 enum/ko/null-last 정렬과 코드 대조. 실엔진은 V11에서 별도 판정. |
| V2 | pass | 빈 목록·LD-only OM 보완·OM-only·미분류 및 역할 없음 분리 테스트. 오류 시 fallback하지 않음. |
| V3 | pass | Coach mock 비교에서 list/detail 삭제 정책 차이, 평균 3·고유 근무일 1, 분야·커리큘럼, latest completed archive, null/빈 문자열 구분. |
| V4 | pass | Coach 6개 공개 메서드 비교, 2099-12/2100-01/2100-02 dashboard 및 날짜·취소 필터 코드 대조. bitmap은 기존 순수 함수를 재사용. 실제 쿼리는 V12의 별도 엔진 증거로 보완. |
| V5 | pass | Private 2개 메서드 mock 비교, 없음 null, 날짜 변환·정렬, 공개 DTO에 profile/hiredByText/accessToken 원본이 섞이지 않는 검사. feedback/coachInputUrl은 기존 계약 유지. |
| V6 | pass | mongoOperationStore.ts의 명시적 database/namespace/model set 제한, mongoReadStore readiness 실패 테스트. Operation 기본 7모델과 생산 factory 변경 없음. |
| V7 | pass | 실제 Mongo에서 구키 유지 회전 읽기 성공, 구키 제거 실패·복원, tag/AAD/HMAC/필수 companion 손상 실패·복원. coach-security.log 1 pass/0 fail/0 skip. |
| V8 | pass | 실제 Profile raw 문서의 합성 이메일 비노출, Team raw 이름 암호문/HMAC 확인, mock 공개 DTO의 private 값 비노출 및 일반화 오류 코드 검토. 명령 감시는 명령 이름만 저장. 허용된 합성 fixture와 반환 DTO는 비밀 누출로 취급하지 않음. 임의 운영 로그 전체를 감사했다는 의미는 아님. |
| V9 | pass | 실제 open+8개 조회 구간에서 find를 관측하고 write/DDL 명령 0 확인. 동일 Coach/Profile PK를 다른 준비된 namespace에 넣어 다른 이름/이메일이 각각 반환됨. DB 제한은 V6 코드/단위 검증으로 보완. |
| V10 | pass | 공통 scan의 20,000행/32MiB·15초 제한과 초과 시 오류, Coach 상한 오류 전파 테스트. 다중 collection은 단일 snapshot이 아니라는 코드 주석 확인. 기존 PG보다 높은 동시성 보장을 주장하지 않음. |
| V11 | pass | 7.0.43 실제 Team suite 통과: 합성 조회/필터/기본값/정렬 및 암호문 확인. 총괄 제공 native7b.log 근거. |
| V12 | pass | 수정 fixture로 실제 Coach 6개 메서드·관계·archive suite 통과. coach-verified.log 및 coach-security.log 근거. |
| V13 | pass | 실제 Private 2개 메서드의 null/날짜/feedback 및 유효 형식 암호문 변조 실패·복원 통과. |
| V14 | pass | mock PG/Mongo DTO 비교 pass, 실제 Operation 16개 포함 회귀 pass. 최신 전체 789 pass/7 skip, lint 0 error/기존 7 warning, typecheck/build pass(총괄 제공). 실제 PG adapter 쿼리 비교는 수행하지 않음. |
| V15 | pass | git diff/status 및 신규 소스 검토상 생산 factory·PG schema/migration·환경 키 변경 없음. 본 검토는 실제 데이터 복사·운영 접속·배포를 실행하지 않았으며 전체 runtime/cutover는 미완료. |

## 증거 출처와 최종 실행 결과

본 리뷰어가 직접 실행한 로컬 표적 결과는 위 10 pass / 2 skip이다. 이후 아래 실엔진 및 전체 검증 결과는 **총괄이 전달한 실행 로그 결과**이며 본 리뷰어가 직접 컨테이너를 실행했다고 주장하지 않는다.

- MongoDB 7.0.43 replica set: 외부 네트워크 없는 임시 Mongo와 loopback 공유 테스트 컨테이너, 합성 키·fixture만 사용.
- `native7b.log`: 24 pass, Coach fixture 1 failure. 기존 Operation 16개 및 Team 회귀 포함.
- `coach-verified.log`: fixture unique 식별자 및 URL template 전제 보완 후 native+mock 2 pass / 0 fail / 0 skip. 제품 코드는 변경하지 않았다.
- `coach-security.log`: 최종 키회전·변조·격리·읽기 명령 감시 추가 native 1 pass / 0 fail / 0 skip, 368ms.
- 최종 native 테스트 SHA-256: `e3ea64aae0181b778fb55e62ca5f64d916ab7b2759f178a74e8a28547756a0c5`. 본 리뷰어가 로컬 파일 hash를 직접 확인했으며 총괄이 전달한 서버 실행 파일 hash와 같다. 테스트 내용을 독립적으로 읽어 반례와 복구, 감시 구간, 중첩 finally를 확인했다.
- 최신 전체 789 pass / 7 skip, lint 0 error / 기존 7 warning, typecheck/build pass. 전체 테스트의 DB skip은 위 별도 native 실행 증거와 구분한다.

초기 로컬 listen EPERM/Docker daemon 부재로 미실행이었던 항목은 총괄의 별도 환경 실행으로 보완했다. 최초 실패는 실제 fixture unique 제약 및 URL template 전제를 드러냈고, fixture와 테스트만 수정한 재실행 결과로 해소했다.

## 독립 job 및 남은 범위

shadowJobCommand는 export에 PostgreSQL 자격증명과 read-only PGOPTIONS만, import에 Mongo 자격증명만 전달한다. 앱 서버/마이그레이션 entrypoint를 호출하지 않으며 explicit confirmation과 shadow DB/path/run ID 조건을 검사한다. 관련 단위 테스트 3개가 통과했다. Docker 이미지 build 및 인자 없는 runner 시작 차단도 총괄 제공 결과로 pass다. **실제 source export/import 운영 실행은 수행하지 않았다.**

운영 버전 MongoDB 8.0 검증은 호스트 kernel 제약으로 보류 상태다. 7.0.43 합성 통과를 8.0 호환성 검증·실제 운영 권한 검증·전체 데이터 성능·전체 runtime/cutover 완료로 확대 해석하지 않는다. PG reference 비교는 mock이며 실제 PostgreSQL 쿼리 실행 비교와 구분한다. 다중 collection 조회는 단일 snapshot을 보장하지 않는다.

생산 factory·PG schema/migration·실제 키·운영 데이터는 이번 검토 범위에서 변경하지 않았다.

총괄 정리 확인: remainingSyntheticDatabases=0, label hub-om.synthetic=7hgrdx의 이번 검증 컨테이너3개 stop/rm 완료, 해당 label의 잔존 container0. 합성 로그/검증 이미지 보관.
