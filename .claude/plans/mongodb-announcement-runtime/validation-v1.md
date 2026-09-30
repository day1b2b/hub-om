# Mongo 공지·첨부 runtime 검증 v1

## 현재 결과

- typecheck: pass
- 일반 회귀: 1,090 pass / 102 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 13 pass / 0 skip / 0 fail
- 실제 검증: 공지 API·페이지·multipart·첨부·소프트 삭제·업무/요청 감사, ready 재개 write 0, 부분·실제 중단 namespace 재실행 write 0, scope 분해·중첩 차단, borrowed client
- lint: 오류 0 / 기존 경고 7
- build: pass
- 독립 리뷰: P0/P1/P2 차단 이슈 없음
- PostgreSQL fallback·외부 요청: 0
- 합성 replica set·DB·포트: 종료 후 정리

초기 검증에서 기존 반쪽 scope 검사가 등록 runtime의 선행 차단으로 실패했다. 제품 동작 실패가 아니며, 등록 객체 분해는 callback 0으로 차단하고 별도 미등록 저장소의 포트 누락은 기존 `DATA_REPOSITORY_NOT_CONFIGURED`로 실패하도록 검사를 분리한 뒤 13건을 재실행했다.

독립 리뷰의 실제 준비 중단 재실행 지적에 따라 request audit·guard 준비 후 Announcement 생성 실패를 주입했다. 재실행의 고정 거부·mutation 0·metadata/index/document 불변·client 유지까지 보완한 뒤 같은 13건을 재실행하고 재수락받았다. 일반 회귀의 opt-in skip과 실제 Mongo 13건은 합산하지 않는다.

## 미검증 범위

- 운영 환경과 전체 Next runtime
- production selector·활성 CLI·예약 작업·배포 설정
- 실 A/B 백업·복원·복사·최종 전환
