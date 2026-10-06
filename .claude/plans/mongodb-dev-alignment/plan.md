# 최신 dev 변경의 Mongo 통합 계획

2026-09-30. 기준 `dc39e1940b05fc1724372902c4f8e9c90213771a`, `origin/dev`는 `307f52ff13588869d2cdd18c7c32d162e85c7393`이다. 원본 workspace, main/dev, 운영 DB·실제 원천·키/env·배포·자동화를 변경하지 않는다. 격리 clone의 새 feature에서 일반 병합한다.

## 범위와 대안

원격 dev의 4개 커밋에는 실질 2개 변경이 있다: 만족도 회차 강사평균(75985a6), Calendar 누락 복구(a5592e2). 텍스트 충돌은 없지만 새 `OperationRepository.getOperationCreatedAt`이 Mongo 구현에 없어 보완해야 한다.

선택 복사는 변경량이 작지만 공동 개발 이력과 조상 관계를 잃는다. 일반 병합은 동료 변경과 이력을 보존하지만 새 interface의 의미 검증이 필요하다. 일반 병합을 선택하며 기존 업무 schema·삭제·overall 동일 시 전체 skip 정책을 바꾸지 않는다.

1. 상대 7개 파일 변경 보존. Mongo 생성시각 조회는 PG와 동일한 exact ID, 삭제 표시 포함, 누락 시 null을 유지한다. 관계 조회나 PII 복호화가 필요 없는 metadata projection만 읽는다.
2. 실제 Mongo metadata 조회 및 만족도 POST를 합성 검증한다. Calendar 기존 단위검사에서 신규 회차 생성·레거시/시각 없음 skip을 확인하고 wrapper 위임은 코드로 대조한다. 실제 Google 연동 및 Calendar 전체 저장 전환은 별도다.
3. 일반 테스트·typecheck·lint·build, 전체 Mongo와 기존 PG 회귀, 독립 검토를 완료한다. 소유 자원 정리 후 merge commit, 기능 push, 총괄 fast-forward/push 및 원격 SHA를 확인한다.

수락 기준: 상대 변경 보존, 필수 interface 완성, metadata 조회 부수 쓰기 없음, 만족도 두 필드/빈값 보존/동일 overall skip/미매칭 무쓰기, 외부 fallback 없음, dev가 통합 HEAD의 조상, 최종 검증 실패 없음. 각 수직 단위 시작과 총괄 통합 전에 최신 dev 차이와 겹치는 파일을 점검한다.

범위 확정에 따라 브라우저 임시저장 암호화는 후속으로 유지하되 전환 선행조건에서 제외한다. 현재 기능·권한·개인정보 암호화와 무손실 이전은 필수다. 이중 백업 계획 문서를 함께 작성하지만 실제 백업·복원·전환 증거는 없으며 실행하지 않는다.
