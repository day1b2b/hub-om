# 원천 읽기 상태 composition 실행 리뷰

- 기준 총괄 SHA: `10e5852c6fcf5b2b40c5ce3f0c9e0e58ed8c9125`
- 작업 브랜치: `feature/20261001-source-read-status-composition`
- 범위: `/api/source-reads/status`의 PostgreSQL 기본/Mongo shadow 명시 선택과 request audit·source reader 단일 scope
- 실제 PostgreSQL 17: 1 pass / 0 skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 pass / 0 skip / 0 fail
- 전체 테스트: 1,169 pass / 146 skip / 0 fail
- typecheck/build: 통과
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
- 제품 SHA: `1633976f22e2c1cae13e43faea71748bf1173802`

잘못된 selector·연결 좌표·암호화 설정은 source load·Mongo connect·업무 처리 전에 실패한다. 부분 namespace는 자동 수리하지 않고 기존 snapshot을 보존하며, Mongo 실패를 PostgreSQL로 fallback하지 않는다. 운영 환경과 실제 외부 원천은 사용하지 않았다.

독립 리뷰에서 발견한 같은 키 바이트의 비정규 Base64 alias와 성공 감사 후 client close 실패의 응답 불일치를 수정했다. canonical Base64와 decode 바이트 비교를 강제하고, 완료 후 cleanup 실패는 이미 확정된 업무·감사 결과를 뒤집지 않도록 했다.
