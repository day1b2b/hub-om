# 활동 기록 정리 인계

격리 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`.
작업 브랜치: `feature/20260930-mongodb-activity-prune`.
기준 통합: `b333931a2e7d281b697baf20a75bdf13b8e2b094`.
최신 확인 dev: `307f52ff13588869d2cdd18c7c32d162e85c7393`.

CLI 경계·PG 원본 동작·Mongo 원자적 배치 및 API 자동 정리 연결을 완료했다. 기본 PG, 명시 Mongo shadow만 허용한다. 검증과 독립 리뷰는 final-readiness/execution-review를 읽고 반복하지 않는다. 최종 원격 SHA는 integration-review와 영속 캐시 final-remote.txt를 따른다.

증거: `/Users/ga/.cache/hub-om-verification/20260930-activity-prune`의 source-final.json·sha256.json·logs. 임시 루트 `/private/tmp/hub-om-activity-prune-20260930`에는 기록만 남았으며 소유 서버와 DB 경로는 정리했다. 같은 포트나 자원을 살아 있다고 가정하지 않는다.

새 기능은 시작하지 않았다. 다음 개발 후보는 기존 MongoCoachRepository를 코치 공개 조회 factory/context와 실제 페이지에 연결하는 작은 범위다. snapshot 회사/과정 문자열 개인정보 분류도 필수 보안 검토로 남는다. 상세 후보는 next-scope-reconnaissance.md를 따른다.

운영 전 사용자 결정·외부 조치는 operational-decisions.md에 구분했다. 실제 대상/접근 범위, 독립 A/B 보관처·키 복구, 전환 창과 최종 복사 방식, Mongo 최신 쓰기의 무손실 복구 경로가 필요하다. 문서상 실백업 검증 증거가 없다는 것이 실제 백업의 부재를 의미하지는 않는다. 비밀값은 공개 대화/저장소에 기록하지 않는다.

전체 앱·활성 CLI/예약/배포 구성, 실제 A/B 복원·복사·운영 전환은 완료되지 않았다. 사용자의 dev→main 지시는 모든 작업 완료 후라는 조건이 있으므로 아직 실행하지 않는다. 자동화 PAUSED 인계를 유지한다.
