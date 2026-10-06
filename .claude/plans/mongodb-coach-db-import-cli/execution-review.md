# 코치 DB 가져오기 CLI 실행 리뷰

legacy raw PostgreSQL 스크립트를 read-only source와 기본 encrypted PostgreSQL/명시 prepared Mongo target repository로 분리했다. 기존 코치 upsert, 태그 추가, 운영 매칭, 수동 필드 보존 의미를 유지하면서 target 전체 transaction, HMAC 조회, guard, 고정 오류와 strict CLI 인자를 적용했다.

실제 합성 PostgreSQL source 1, target 1과 Mongo replica set 1, command/CLI 4를 검증했다. 일반 회귀는 1,138 pass/126 opt-in skip/0 fail이고 typecheck/build를 통과했다. source 단일 연결의 동시 query 경고, 누락 부모 참조, date-only 시간대, invalid enum/날짜 부분 commit, HMAC 키 불일치, PG 직렬화 재시도를 보완했다. UTC·서울·미국 서부 시간대와 raw PG/Mongo 전체 rollback을 확인했다. 경쟁 충돌 강제 barrier, source 조회 사이 변경 barrier, 실제 script process entry는 미검증이며 PASS로 계산하지 않는다. 실제 운영 source·Atlas·키·설정은 검증하지 않았다.

독립 최종 리뷰는 보완 후 잔여 P0–P3 없음으로 종료됐다. 리뷰어는 미검증 세 항목을 한계로 유지했으며 테스트 실행은 부모 검증 기록을 사용했다.
