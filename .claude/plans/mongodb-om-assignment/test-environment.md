# 합성 검증 환경

현재 수락 대상은 2026-09-30 새 실행이다. 09-29 임시 root는 소실돼 그 로그의 최종 상태를 재확인할 수 없다.

- Node24.19.0: `/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- PostgreSQL17.9: `/opt/homebrew/opt/postgresql@17/bin`
- Mongo8.0.30: 공식 `mongodb-macos-arm64-8.0.30.tgz` 격리 unpack 실행. 앱 의존성 추가 없음.
- 소유 root: `/private/tmp/hub-om-om-assignment-20260930`
- 새 PG dbpath `pg`, loopback56719, synthetic role, om_assignment_parity DB.
- 새 Mongo dbpath `mongo`, loopback27819, omassignment20260929 replica set.
- 프로세스 env-i, clone dotenv 파일 없음, 테스트 안에서 random 임시 PII 키 생성.
- 기존 사용자 PG18 서비스는 접근하거나 정리하지 않는다.
- 실행 스크립트 `run.sh pg/static/mongo`. timeout/yield 기반 비동기 실행. 새 logs 및 완료 로그 사본 `/Users/ga/.cache/hub-om-verification/20260930-om-assignment`.

PG oracle은 현재 DB/user, 비어 있는 schema와 replica set을 확인한 뒤45migration을 적용하고 종료 시 자기 schema/DB만 정리한다. Mongo 각 suite는 무작위 shadow DB를 만들고 자기 DB를 삭제한다. 서버/경로 정리는 모든 검사 종료 후 cleanup.sh의 정확한 dbpath/DB잔존 검사 다음에만 수행한다. 최종 정리 상태는 execution-review.md를 따른다.
