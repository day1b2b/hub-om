# 독립 critic — 계획 리뷰

Carver가 v1의 commit ACK와 callback 재시도 구분, 실제 nonce ACK barrier, namespace와 Google 객체 구분, OAuth 대기 후 검사, 복원 양성 fixture를 요구했다. v2는 이를 대부분 반영했다.

v2 중간 판정: Core가 존재하고 방향 A는 수락 가능. 남은 P1은 자연 만료 takeover를 mapping10초/lease60초/진입여유16초와 동시에 요구하는 검증 일정의 모순이다. 제품 예산을 유지하고 실제 만료의 기한 종료·commit 잔존과 예산 내 명시 fault/ACK 재확정을 분리하는 대안을 채택한다. 저장이 최종 불명이면 mapping이 있어도 원래 증가 위치상 inserted0/failed1, 예산 내 ACK 확정으로 저장 함수가 반환했을 때만1/1이다.

P2: mutex 대기 후 상태·예산 재검사, 내부 renew/guard의 재진입 deadlock 방지, 동일10초 deadline 유지, 선행 통합 상태 갱신. 최종 validation-v2 대조는 아직 대기다. 제품/DB 실행 PASS가 아니며 reviewer는 파일을 수정하거나 DB/테스트를 실행하지 않았다.

## 최종 계획 판정

Carver가 시간예산 P1 해소와 설계 방향·구현 진입을 수락했다. 마지막 세 문구(K4 공개키/listAll read는 GCM 후 INDEX_MISMATCH, actor와응답requestId 분리, 완료된promotion gate 잔여문구)는 부모가 정확히 정정했다. 추가 착수 조건은 없다는 독립 판정이며 실제 구현/실행 수락은 별도다.
