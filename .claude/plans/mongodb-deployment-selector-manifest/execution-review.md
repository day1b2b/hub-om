# Mongo 배포 selector manifest 실행 리뷰

- 범위: production composition의 35개 backend selector와 `.env.example`, 정적 배포 점검 CLI
- 기본값: 모든 기능군은 PostgreSQL
- Mongo 기대: 전 selector exact `mongodb-shadow`, 공통 shadow/PII 설정 유효, `RUN_DB_MIGRATIONS=true` 거부
- 외부 영향: DB·원천·Coolify·예약 설정 접근 및 변경 0
- 집중 검증: manifest/예시/판정/실제 CLI 4건
- 전체 검증: 1551개 중 1375 pass·176 skip·0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7
- 초기 독립 리뷰: P0 0·P1 0·P2 2·P3 0. Mongo URI 문법 검증과 공백 PII active key ID 판정 불일치를 보완했다.
- 리뷰 수정 검증: MongoClient 생성자의 드라이버 URI 파싱만 사용하며 소켓을 열지 않는다. 공백 key ID와 잘못된 URI 음수 사례를 집중 검증했고 전체 회귀·typecheck·build도 다시 통과했다.
- 최종 독립 재리뷰: P0 0·P1 0·P2 0·P3 0, 통합 가능. 리뷰어 집중·관련 테스트 15/15와 공백 검사를 별도로 통과했다.
- 미완료: 실제 namespace readiness·A/B 백업/복원·운영 복사·배포·전환
