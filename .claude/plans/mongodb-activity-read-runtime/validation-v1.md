# Mongo 활동 조회 runtime 검증 v1

## 현재 결과

- typecheck: pass
- 일반 회귀: 1,090 pass / 102 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 11 pass / 0 skip / 0 fail
- 활동 조회 runtime: 실제 세 GET의 9개 세부 계약, 준비·재개·부분 namespace·scope·client 계약 포함
- 공통 namespace 감지 회귀: 기존 내부 운영 runtime 1 pass
- lint: 오류 0 / 기존 경고 7
- build: pass
- 독립 리뷰: P0/P1/P2 차단 이슈 없음
- PostgreSQL fallback·외부 요청: 0
- 합성 replica set·DB·포트: 종료 후 정리

실제 Mongo 11건은 일반 회귀의 opt-in skip과 합산하지 않는다. 리뷰에서 발견한 실제 GET mutation ledger와 합성 DB 소유권 검증 공백을 보완한 뒤 재실행·재검토했다.

## 미검증 범위

- 운영 환경과 전체 Next runtime
- `/changes`의 코치 콘텐츠 쓰기
- production selector·활성 CLI·예약 작업·배포 설정
- 실 A/B 백업·복원·복사·최종 전환
