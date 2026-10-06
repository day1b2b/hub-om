# Drive history 인계

먼저 execution-status → execution-review → execution-manifest → alignment-review → integration-review를 읽는다. 완료된 Calendar·Drive 조회 구현/합성 검증을 반복하지 않는다.

이번 범위는 두 저장 이력 조회와 기존 page이며 기본 PG 유지. CLI dry-run은 실제 writer이므로 별도 후속이다. Mongo/PG 합성 서버와 dbpath는 정리 완료, 빌린 binary는 보존. 재검증이 필요하면 새 소유 endpoint/path/키를 사용한다.

다음 후보는 Google Sheets tabs/import의 합성 source→기존 staging 경계. 독립 계획 검토 후 별도 feature branch에서 진행한다. 외부 사전계획은 /private/tmp/hub-om-drive-import-history-20260930/next-google-sheets-import-plan/에 준비 중이며 최종 baseline은 Drive 통합 HEAD로 고정한다. scope 누락 시 external fetch 이전 차단, 실제 handler/auth/parser/native staging 검증이 필요하다. 실제 Sheets/Notion 접근·새UI·권한·schema 변경은 포함하지 않는다.

전체 앱 Mongo 조립·CLI/예약 작업·backup/health·privacy snapshot 분류·운영 collation·실제A/B백업복원복사최종전환은 미완료. 사용자 dev→main 요청은 전체 완료 후 조건부이며 아직 충족하지 않았다. 자동화는 사용자 인계 PAUSED를 유지하고 자동 재개하지 않는다. 실제 설정을 이번에 조회/변경하지 않았다.
