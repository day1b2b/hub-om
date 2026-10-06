# Mongo 팀 명칭 보정 CLI 계획 v1

1. 패키지의 실제 legacy CLI와 두 exact rename·dry-run/`--apply`·출력을 유지한다.
2. raw SQL을 TeamUser 저장 경계의 count/조건부 bulk rename으로 교체한다.
3. 기본 PG를 유지하고 local file 선택은 거부하며, 명시 Mongo는 준비된 user-admin shadow만 연다.
4. Mongo는 team 외 PII 암호문·companion을 읽거나 다시 쓰지 않는다.
5. 실제 합성 Mongo·전체 회귀·독립 리뷰 후 작업·총괄 브랜치에만 통합한다.

운영 설정·데이터·예약·배포, 팀 목록·삭제 정책, dev/main은 변경하지 않는다.
