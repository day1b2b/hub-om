# Mongo 관리자 DB runtime 검증 v1

- 일반 회귀: 1,090 pass / 104 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 12 pass / 0 skip / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: 자원 소유권 P2 보완 후 P0/P1/P2 잔여 없음
- PG/local/external 접근: 0
- 합성 replica set·DB·port: 종료 후 정리

첫 실제 실행의 두 실패는 등록 runtime의 동기 scope 차단을 비동기 assertion으로 검사한 테스트 문제였다. assertion을 수정하고 준비 재실행·중단 불변·중첩 차단을 추가한 뒤 통과했다. 독립 리뷰에 따라 DB 사전 부재·소유 DB만 삭제·borrowed client close 0·마지막 ping·실제 close를 추가해 새 replica set에서 재검증했다.

운영 환경·브라우저 전체 흐름·production selector·실 A/B 백업/복원/복사/최종 전환은 미검증이다.
