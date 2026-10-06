# Handoff: mongodb-coach-public-pages

## 완료 범위

- 공개 coach factory의 명시 `coach` context 우선 선택
- 기존 7개 page의 actual Mongo 정상·권한·오류·DTO 검증
- 기본 PG, 누락 scope fail-closed, 동시 namespace 격리 검증
- Google Drive/OneDrive 백업 후보와 남은 운영 gate 문서화
- 일반 test/typecheck/lint/build 완료

## 남은 전체 작업

- 전체 앱 composition root와 활성 CLI·예약 작업·배포 경로의 일관된 backend 조립
- snapshot의 민감 문자열 정책 검토와 필요한 암호화/변환
- 운영 collation·timezone·인덱스 차이 대조
- Google Drive A와 OneDrive B의 실제 독립성·용량·보존·암호화·복구권한 확인
- 실제 백업 업로드·무결성·각각의 격리 복원, 실제 데이터 복사·최종 동기화·rollback 리허설
- 모든 기능·운영 gate가 닫힌 뒤에만 dev→main 검토

자동화는 PAUSED 상태를 유지한다. 운영 DB·실원천·운영 키·배포·main/dev는 변경하지 않았다.
