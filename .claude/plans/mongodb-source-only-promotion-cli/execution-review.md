# 팀 단위 원천 승격 CLI 실행 리뷰

legacy raw pg `db:promote-source-only`를 기본 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체했다. 기존 팀 기본값과 팀 전체·복수 import run, 비차단 오류, 지문 연결, 필드 변환·Member 역할 명단을 유지했다. 기본 dry-run, apply의 백업·점검 확인, counts-only 출력과 전체 transaction을 추가했다. 웹의 단일 run 승격 계약은 변경하지 않았다.

실제 PostgreSQL 17과 MongoDB 8.0.30 replica set에서 복수 run·중복 지문·dry-run 무쓰기·apply·재실행·암호화 저장·후반 고유성 실패 rollback과 재시도를 확인했다. 독립 리뷰가 `avgSatisfaction` 누락, 같은 지문의 dry-run/apply 집계 차이, legacy 자연키 공백 정규화 차이, 커밋 뒤 연결 정리 실패 안내의 P2 네 건을 재현해 모두 보완했다. 최종 변경 기준 일반 회귀는 1,150 pass/130 opt-in skip/0 fail, command/core/runtime 7 pass, 실제 DB 각 1 root pass다. typecheck/build 통과, lint 오류 0·기존 경고 7이다.

실제 운영 DB·원천·키·백업·배포는 사용하지 않았다. 강제 PostgreSQL P2034, 실제 두 writer barrier 경합과 운영 규모는 미검증이다.
