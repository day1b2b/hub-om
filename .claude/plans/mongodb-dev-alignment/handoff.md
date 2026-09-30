# dev 정합 작업 인계

2026-09-30, 범위 확정 후 재개한 통합 검증 작업이다. 기존 OM 배정 완료 범위는 다시 구현하지 않았다.

## 현재 코드와 병합 상태

- 작업 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`
- 브랜치: `feature/20260930-mongodb-dev-alignment`
- 시작 HEAD: `dc39e1940b05fc1724372902c4f8e9c90213771a`
- dev 병합 부모: `307f52ff13588869d2cdd18c7c32d162e85c7393`
- 일반 병합 중이며 아직 merge commit/push 전이다. dev의 7파일은 보존하고 Mongo 생성시각 조회와 합성 검증을 추가했다. 임의 merge abort/reset 금지.
- source digest는 `verified-source-digests.json`, 검사 상태는 `execution-review.md`, 독립 검토는 `independent-review.md`를 따른다.

## 검증과 자원

새 합성 root는 `/private/tmp/hub-om-dev-alignment-resumed-20260930`이다. loopback PG17.9와 Mongo8.0.30 replica set만 사용한다. 전체 Mongo705pass/0skip/0fail이 완료됐고 소유 자원을 정리했다. typecheck/build 및 일반 920pass/65skip, lint0error/기존7warning, 개별 metadata17, 기존 OM PG56은 통과했다. 중복 묶음 합산 금지. 실제 Google/인증 공급자/운영 데이터는 검증하지 않았다.

최종 로그는 `/Users/ga/.cache/hub-om-verification/20260930-dev-alignment`에 보존했다. PG/Mongo 데이터 경로가 없고 포트56719/27819가 닫혔음을 확인했다.

중지 전 자료는 `/Users/ga/.cache/hub-om-verification/20260930-dev-alignment-paused`에 있고 해당 자원은 이미 정리됐다. 재개 결과와 혼합하지 않는다. OM 배정 이전 완료 자료는 `../mongodb-om-assignment/`와 `/Users/ga/.cache/hub-om-verification/20260930-om-assignment`에 있다.

## 남은 통합 마무리

전체 회귀와 소유 정리 완료. 최종 독립 실행 수락, merge commit/기능 push/총괄 fast-forward와 정확한 원격 SHA 확인은 integration-review를 따른다. 원격 dev는 재개 중 fetch 후 307f52f 그대로 확인했다. 이후 각 수직 단위 시작과 총괄 통합 전 dev 차이/겹치는 파일을 확인한다.

## 전체 이전 범위

Mongo 이전, 현재 사용 기능·권한·개인정보 암호화 유지, 데이터 무유실은 필수다. 브라우저 임시저장 암호화는 후속으로 보존하며 이번 전환의 선행조건은 아니다. 사용 불명확한 CLI/예약 작업은 호출·배포 근거를 확인하기 전 제외하지 않는다.

남은 코드 기능군은 가져오기/staging/승격·Drive 기록, Calendar 저장/잠금·역동기화, 백업/health, 전체 요청·페이지·작업 연결이다. 코드 준비와 별개로 실제 복사/복원/최종 전환은 미완료다. 이중 백업과 쓰기 이후 복귀 계획은 `docs/operations/mongodb-backup-cutover-plan.md`를 따른다. 실제 백업 확인 증거0이며 A/B 각각 무결성·키 복구·격리 복원·앱 검증 전 운영 전환을 하지 않는다.

원본 workspace, 운영 DB/Atlas/실제 원천, 운영 키/env/배포, main/dev, 자동화 설정은 변경하지 않는다. 최종 dev→main 조건은 아직 충족하지 않았다.
