# Mongo 변경 내역 runtime 검증 v1

## 최종 결과

- 일반 회귀: 1,090 pass / 103 opt-in skip / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7
- 실제 MongoDB 8.0.30 replica set: 1 pass / 0 skip / 0 fail
- 실제 검증: 네 포트의 같은 namespace 조립, 실제 feed/note/review/activity handler, 응답·감사 귀속·저장 암호화, ready 재개 write 0, 실제 준비 중단 재실행 write 0, 포트 분해·혼합·중첩 차단, borrowed client
- 독립 리뷰: P0/P1/P2 잔여 없음, 초기 P2 3건 해소 후 수락
- PostgreSQL fallback·외부 요청: 0
- 합성 replica set·DB·포트: 종료 후 정리

독립 리뷰의 초기 P2 세 건에 따라 aggregate `$out`·`$merge`를 mutation 감시에 포함하고, 등록 runtime 포트별 누락과 다른 runtime 포트 혼합을 추가했다. 실제 handler 응답 값, ActivityRequest의 route·status·actor, request ID와 ActivityChange target 연결도 강화한 뒤 새 replica set에서 재실행했다.

## 미검증 범위

- 브라우저에서 실행되는 `/changes` 전체 사용자 흐름
- 운영 namespace·키·권한·부하와 전체 Next runtime
- production selector·활성 CLI·예약 작업·배포 설정
- 실제 A/B 백업·각 복원·복사·최종 전환
