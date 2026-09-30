# Handoff: mongodb-snapshot-privacy

## 완료 범위

- Drive 결과 snapshot 회사명·과정명의 PG/Mongo 저장 암호화와 HMAC companion
- 기존 PG C byte 정렬, exact equality, 동일 이름 중복, 승인 응답 원문 보존
- migration/backfill/enforce와 legacy·partial·retry·키 불일치 합성 검증
- Mongo validator/index/구 namespace 거부와 35모델 export/import codec 검증
- 운영 적용·복구·새 shadow 재복사 절차 문서화
- 일반 test/typecheck/lint/build와 독립 리뷰

독립 최종 리뷰는 보완 후 P0/P1/P2 잔여 없음으로 합성 기능 범위를 수락했다. 일반1084 PASS/101 opt-in skip, 실제 PG snapshot1·source partial1, Mongo79, codec/export/import·privacy65, Sheets/Notion 동결60, typecheck/build PASS, lint0error/기존7warning이다. 묶음은 중복 합산하지 않는다. 소유 합성 서버·DB·dbpath·포트를 정리했다.

## 남은 전체 작업

- 운영 collation/TZ 대조
- 전체 앱 composition root와 활성 CLI·예약 작업·배포 경로의 일관된 backend 조립
- Google Drive A와 OneDrive B의 실제 독립성·용량·보존·암호화·복구권한 확인
- 실제 백업 업로드·무결성·각 격리 복원, 실데이터 복사·최종 동기화·rollback 리허설
- 모든 기능·운영 gate가 닫힌 뒤 dev→main 검토

운영 migration/backfill/enforce와 기존 shadow 변경은 실행하지 않았다. 생산 기본은 PostgreSQL이며 자동화 PAUSED를 유지한다.
