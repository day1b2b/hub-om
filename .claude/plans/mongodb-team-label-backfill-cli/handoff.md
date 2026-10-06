# Mongo 팀 명칭 보정 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-team-label-backfill-cli`
- 제품 커밋: `f616ceaf6f6d4d72fc76a76eb0f04c9cdd447cc9`
- 기본 PG와 legacy dry-run/`--apply`·두 라벨·출력을 유지한다.
- local-file 기본 실행을 거부하고 명시 Mongo는 준비된 user-admin shadow만 연다.
- Mongo는 team만 exact 조건으로 갱신하며 PII 암호문·companion은 byte 불변이다.
- 일반 1,110 pass/110 skip, actual Mongo 1 pass, focused 8 pass, typecheck/build/lint와 독립 리뷰를 통과했다.
- 운영 적용·예약·배포·실데이터는 없으며 production 전체 selector, 백업·복원·최종 전환과 dev→main은 미완료다.
