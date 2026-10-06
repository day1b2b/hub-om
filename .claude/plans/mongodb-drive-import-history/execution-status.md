# Drive history 실행 상태

2026-09-30. 기준 `73a137ac8b8fe16bf6128b81529ab35d6de01031`, 작업 branch `feature/20260930-mongodb-drive-import-history`.

두 저장 이력 조회와 기존 페이지의 명시 Mongo 경계를 구현하고 검증했다. 기본 PG 유지, 실제 원천/운영 DB 접근0. 최종 독립 정합은 alignment-review, 원격 통합은 integration-review를 따른다.

| 실행 | 결과 | 구분 |
| --- | --- | --- |
| 일반 전체 npm test | 957 pass / 83 skip / 0 fail, exit0 | 명시 DB opt-in 없는 검사는 skip, PASS로 세지 않음 |
| 실제 PG 선행 gate | 1 root pass / 0 skip / exit0 | 내부26태그, C/SQL_ASCII 합성 기준 |
| 원본PG/currentPG/native parity | 1 root pass / 0 skip / exit0 | 내부55/55/48 cases, test 수로 합산 금지 |
| 실제 페이지 SSR | 원본PG7/currentPG8/native8, 모두0skip/exit0 | 실제 브라우저·OAuth 아님 |
| native + scope | 79 pass / 0 skip / exit0 | scope 검사는 일반과 중복, 합산 금지 |
| Calendar 인접 회귀 | handler21 + scope3 =24 pass / 0 skip / exit0 | 주소1리터럴만 새 소유 endpoint로 치환, 전체 Mongo 묶음 아님 |
| typecheck / build | 각각 exit0 | 최종 page 타입 보완 후 typecheck 재확인 |
| lint | exit0, 오류0, 기존 경고7 | 신규 테스트 경고/오류 제거 |

이번에는 영향 범위에 따라 Drive native와 공통 context의 Calendar 회귀를 실행했다. 이전 Calendar 전체 Mongo963을 이번 변경의 전체 Mongo 재실행으로 주장하지 않는다. 일반 전체 검사와 DB 필수 묶음 숫자는 합산하지 않는다.

소유 PG56750/Mongo27850의 업무 테이블/테스트DB/작업 잔존0을 확인했고 서버 종료·두 port 닫힘·소유 dbpath 삭제를 완료했다. 빌린 mongod 바이너리와 사용자 원본 workspace는 보존했다. 증거는 `/Users/ga/.cache/hub-om-verification/20260930-drive-import-history/`에 보존했다.

실패/보완·검사별 최종 소스·한계는 execution-review.md와 execution-manifest.json을 따른다. 전체 앱/CLI writer/실제 A·B 백업·복원·복사·운영 전환은 미완료이며 실제 백업 증거0이다.
