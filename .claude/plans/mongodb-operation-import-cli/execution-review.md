# 실행 검토

legacy raw pg `db:import:operations`를 기본 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체했다. 기존 JSON 정규화·필수값·날짜, operationId 우선/업무키 보조 매칭, 회사·과정 upsert, 운영 갱신, 가져오기 실행·원천 행과 재실행 의미를 유지했다. 기본 dry-run과 apply 백업·점검 확인, counts-only 출력을 적용했다.

실제 PostgreSQL 17과 MongoDB 8.0.30 replica set에서 같은 파일의 업무키 중복, dry-run 최종 무쓰기, apply·재실행, 암호화 저장, 후반 숫자 범위 실패 전체 rollback을 확인했다. 독립 리뷰가 업무키 예측 캐시의 오래된 매핑 P1과 operationId 별칭·dry-run 이동 후보·기존 후보 순서 P1/P2를 재현했다. 별도 캐시를 제거하고 두 backend 모두 apply와 같은 순차 저장 transaction을 dry-run에서 의도적으로 전체 rollback하도록 보완했으며, 최종 독립 재검토에서는 추가 결함이 발견되지 않았다. 최종 일반 회귀 1,157 pass/132 opt-in skip/0 fail, command/core/runtime 7 pass, 실제 DB 각 1 root pass, PostgreSQL package launcher dry-run/apply/re-run, typecheck/build 통과, lint 오류 0·기존 경고 7이다.

운영 DB·Atlas·실제 파일·원천·키·배포 설정은 사용하지 않았다. 강제 P2034, 실제 두 writer barrier 경합과 운영 규모는 미검증이다.
