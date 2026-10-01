# Mongo 배포 selector manifest 인계

코드의 기능군 selector 35개를 manifest와 `.env.example`의 명시적 PostgreSQL 기본값으로 고정한다. 정적 점검 CLI는 완전한 PostgreSQL 상태 또는 완전한 Mongo shadow 기대 상태만 확인하며 DB에는 연결하지 않는다.

실제 운영 환경·Coolify·예약 작업은 변경하지 않았다. 실제 A/B 백업과 각 복원, namespace readiness, 운영 데이터 복사, 외부 원천, 전환 창과 복구 경로는 계속 선행조건이다.
