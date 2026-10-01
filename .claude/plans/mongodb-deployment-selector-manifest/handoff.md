# Mongo 배포 selector manifest 인계

코드의 기능군 selector 35개를 manifest와 `.env.example`의 명시적 PostgreSQL 기본값으로 고정한다. 정적 점검 CLI는 완전한 PostgreSQL 상태 또는 완전한 Mongo shadow 기대 상태만 확인하며 DB에는 연결하지 않는다.

실제 운영 환경·Coolify·예약 작업은 변경하지 않았다. 실제 A/B 백업과 각 복원, namespace readiness, 운영 데이터 복사, 외부 원천, 전환 창과 복구 경로는 계속 선행조건이다.

검증된 구현은 작업 브랜치와 총괄 feature 브랜치에 첫 통합 SHA `0c96bb42692f0359eb34dacf91013e325c586538`로 반영했다. 최종 문서 커밋 이후 두 원격 브랜치의 동일 SHA를 다시 확인한다.
