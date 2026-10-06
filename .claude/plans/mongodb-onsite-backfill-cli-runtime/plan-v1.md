# Mongo 현장 투입 보정 CLI runtime 계획 v1

1. legacy CLI의 기본 dry-run, `--apply`, 대상 조건과 성공 출력을 유지한다.
2. raw SQL을 기존 operationBackfill repository command로 교체해 암호화 저장 경계를 따른다.
3. 기본 PG를 유지하고 한 개의 명시 Mongo selector만 준비된 shadow runtime에 연결한다.
4. 준비·수리·fallback 없이 실행하고 모든 종료 경로에서 소유 client를 닫는다.
5. 실제 합성 Mongo와 전체 회귀, 독립 리뷰 후 작업·총괄 브랜치에만 통합한다.

운영 설정·실데이터·예약·배포, 보정 정책, dev/main은 변경하지 않는다.
