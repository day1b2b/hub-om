# 실행 근거

Task: MongoDB API 경계 / Level 3 / 2026-09-22.
기준: feature/20260922-mongodb-parallel-transition, 48b0f8b 이후 변경. 기존 workspace의 미커밋 파일은 보존했다.

## 구현
- 실제 Coach 관리 두 route → interface/factory → Prisma 기본 또는 명시 Mongo context. Team 6 export facade와 legacy adapter 분리. Instructor factory 및 save 인증 보완.
- 요청별 immutable-map ALS, 누락 서비스 실패, cached Prisma getter와 Calendar raw PG lock 차단.
- Coach/Team/Instructor 변경 감사 원자성, redaction 및 codec 암호화. Mongo request/PII 접근 감사와 기존 보존 기간 정리.
- 실제 handler/service + 합성 세션 guard 검증. UI/OAuth/실제 PG 쿼리 검증과 구분.

## 실행 결과
| 명령/범위 | 결과 | 로그 |
| --- | --- | --- |
| npm test (최종) | 826개 중 814 pass, 12 skip, 0 fail | /tmp/hub-api-all-tests-final.log |
| npm run typecheck (최종) | pass | /tmp/hub-api-type-final.log |
| npm run lint | 0 error, 기존 경고 7개 | /tmp/hub-api-lint.log |
| npm run build | pass | /tmp/hub-api-build.log |
| 명시 loopback Mongo8 native 묶음 | 30 pass, 0 skip, 0 fail. TeamMember mock 4개 포함 | /tmp/hub-mongo8-api-native-final.log |
| 독립 리뷰어의 unit 4파일 | 10 pass | /tmp/hub-api-review-unit.log |

Native 실행: Node24 `--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/mongo*.integration.test.ts src/lib/data/mongoTeamMemberRepository.test.ts src/lib/data/teamUsers/mongoTeamUserRepository.integration.test.ts`.
관련 MONGODB_*_TEST_URI는 모두 `mongodb://127.0.0.1:27923/?replicaSet=hubShadow`. env -i로 운영 DB/키 미주입. 테스트 전용 키와 무작위 합성 DB 사용. 서로 다른 검사 묶음의 수치를 합산하지 않는다.

MongoDB 공식 macOS arm64 8.0.30 archive와 공식 sha256 일치 확인: 172542980a64452b843fe126782c59e51f0c29359f536a3373035ab2fe0754f6. 임시 mongod는 localhost 전용. 이 결과는 운영 cluster나 정확히 같은 patch 버전의 검증이 아니다.

## 실패와 보완
- 첫 native 묶음에서 Team의 비민감 team 변경을 redacted로 기대한 테스트 1개 실패. PG 감사 계약은 before/after이므로 기대값 수정, 개인정보 name/email/slack redaction 별도 검증 후 최종 통과.
- 독립 리뷰의 CoachManagement open driver 오류 노출 지적 수정 및 반례 추가.
- 독립 리뷰 요청에 따라 Coach/Instructor ActivityChange validator 실패를 주입하고 업무/감사 rollback을 검증.
- 자식 작업의 localhost EPERM 검사는 루트의 허용 환경에서 재실행하여 통과. 실패를 성공으로 숨기지 않았다.

## 미검증 / 운영 미반영
생산 UI/OAuth, 실제 PG query parity, 운영 Mongo 권한/성능, 실제 source 복사/최종 동기화/복원, 전체 runtime 전환, main merge/배포. Team 삭제 정책 및 조회 한도는 gap-plan 참조.

임시 자원 정리: 합성 DB 잔여 0개 확인 후 해당 localhost mongod만 종료, 로그 exitCode 0 및 프로세스 없음 확인. 소스/검증 로그는 보관했다. 원본 workspace 상태도 시작 시와 동일함을 확인했다.
