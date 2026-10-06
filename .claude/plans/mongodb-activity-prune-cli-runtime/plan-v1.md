# Mongo 활동 정리 CLI runtime 계획 v1

1. 기존 `activity:prune`의 무인자 PostgreSQL 동작과 무시 인자 호환성을 유지한다.
2. exact Mongo shadow selector에서만 명시 좌표로 client를 소유하고 준비된 operational runtime을 연다.
3. 준비·수리·fallback 없이 만료 활동을 정리하고 성공·실패 뒤 client를 닫는다.
4. 합성 replica set에서 삭제·거부·무변경·재실행 경계를 검증한다.
5. 전체 회귀와 독립 리뷰 후 작업 브랜치와 총괄 브랜치에만 통합한다.

운영 예약·배포 설정, 실제 데이터, production 전체 selector와 dev/main은 수정하지 않는다.
