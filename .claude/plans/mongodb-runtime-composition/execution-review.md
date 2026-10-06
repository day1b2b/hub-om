# PostgreSQL runtime preflight 실행 검토

## 결과

- 읽기 전용 runtime preflight 구현 완료
- 독립 리뷰 최초 P1 2건/P2 2건과 후속 종료 P2 1건을 모두 보완
- 최종 독립 판정: P0/P1/P2 없음, 합성 기능 범위 수락

## 최종 검증

- 일반 테스트: 1,089 pass / 101 opt-in skip / 0 fail
- runtime preflight 집중 테스트: 6 pass / 0 skip / 0 fail
- typecheck: pass
- production build: pass
- 전체 lint: 오류 0 / 기존 경고 7
- 변경 파일 lint: 오류·경고 0
- 실제 PostgreSQL 17 C/UTF8: compatible/0
- 실제 PostgreSQL 18 C/UTF8: compatible/0
- 실제 PostgreSQL 18 ICU ko-KR: byte collation blocked/2
- URL startup `options` 충돌: 연결 전 고정 오류/1
- 합성 DB 사용자 테이블: 모두 0
- 임시 PG cluster/포트/파일: 정리 완료

## 보장과 한계

연결 시작부터 read-only startup option을 적용하고 URL override를 거부한다. 시스템 카탈로그와 고정 합성 문자열 외 업무 테이블을 읽지 않는다. 비동기 driver 오류와 종료 실패/timeout은 원문 없이 실패하며, 종료가 확인되지 않으면 오류 listener를 유지한다.

이 결과는 합성 PostgreSQL의 preflight 구현 수락이다. 실제 운영 PostgreSQL 실행, 전체 앱 Mongo scope, 운영 selector·배포, A/B 백업·각 복원, 키 복구, 실데이터 복사·최종 전환을 검증하거나 승인하지 않는다.
