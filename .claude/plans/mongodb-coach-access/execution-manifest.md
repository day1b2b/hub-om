# 실행 근거

2026-09-22 / feature/20260922-mongodb-parallel-transition / 32bd456 이후 변경 / Level3.

## 산출물
1. 토큰 조회 및 본인 DTO: coachTokenRepository/interface/factory, Prisma/Mongo adapter, coachTokenAuth, api/coach/me. 삭제/변조 거절, exact-case 인증, 최신 완료 archive 및 whitelist.
2. 개인정보 export: CoachExportRepository/interface/factory, Prisma/Mongo adapter, api/coaches/export, coachExportCsv. 실제 권한 검사, audit transaction, UUID정규화/2만상한, 수식방지/private cache.
3. 토큰 재발급: CoachTokenRotationRepository/interface/factory, Prisma/Mongo adapter, regenerate-token route. live-row update, 삭제404, 토큰/HMAC/감사 원자성, 신규token no-store.
4. dataRepositoryContext에 type-only 서비스3개 추가. 외부 selector 없음. 단위/mock 및 실제native 테스트, 공개문서3개.

## 검증
| 범위 | 결과 | 로그 |
| --- | --- | --- |
| 최신 npm test | 840 total, 825 pass, 15 skip, 0 fail | /tmp/hub-access-all-tests-final.log |
| 전체 Mongo8.0.30 loopback 묶음 | 33 pass, 0 skip, 0 fail; TeamMember mock4 포함 | /tmp/hub-access-native-final.log |
| typecheck (최종) | pass | /tmp/hub-access-type-final.log |
| lint | 0 error, 기존7warning | /tmp/hub-access-lint.log |
| build | pass | /tmp/hub-access-build.log |

Node24, env -i, 테스트용 합성 키와 `mongodb://127.0.0.1:27923/?replicaSet=hubShadow`, 무작위 shadow DB만 사용. 신규 URI는 MONGODB_COACH_ACCESS_TEST_URI. 기존 native URI 변수도 동일 localhost를 가리켰다. 테스트 수치는 중복을 합산하지 않는다.

실패와 해결: Node strip-types가 parameter property를 지원하지 않아 export constructor를 일반 필드로 수정했다. 첫 전체 회귀는 담당자가 UUID검사를 편집하는 사이 구 테스트가 실행돼 실패했으며 파일 안정화 후 최신 전체 재실행825pass로 확인했다. 독립리뷰 E1/E2에서 export/rotation UUID case의 PG/Mongo 차이를 발견해 정규화 및 실제route 반례로 수정했다. 자식 sandbox의 localhost EPERM은 루트 허용 환경에서 native 검증하여 해소했다.

실제 auth guard 검사는 세션 공급만 synthetic mock한다. agent unit의 auth/activity mock 및 PG query mock과 구분한다. 실제 PG·OAuth·UI·운영 Mongo 권한/부하/데이터 복사·복구·배포는 미실행.

자원/보존: 합성 DB잔여0개 확인, 해당 localhost mongod exitCode0/프로세스없음 확인. 원본workspace dirty상태는 시작시와동일. 테스트소스/로그보관.
