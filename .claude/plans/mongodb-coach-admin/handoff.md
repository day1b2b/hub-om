# Handoff

- 위치: feature/20260923-mongodb-coach-master-restore, 기준 d813eac. commit/원격 SHA와 총괄 통합 결과는 최종 인계 메시지 참조.
- 결과: 태그 마스터·삭제 코치 목록/복원/영구삭제의 context 경계, 기본 PG adapter. Mongo 영구삭제는 Cascade/SetNull 재현. 접근 기록 두 경로 코치 잠금 참여.
- 검증: execution-review.md. PG 기준 측정과 Mongo 동일 fixture 비교, 경합 음성 대조, 독립 리뷰(P0/P1 없음, P2 3건 반영).
- open gap: 감사 행 수·내용 동일성 미비교, 운영 collation 정렬 확인, 대형 이력 영구삭제(20,000행 초과) Mongo 실패, 30초 초과 동기화와 겹친 개인정보 조회 실패 가능.
- 전체 잔여: 코치 메모·콘텐츠·관리 조회, coachMyPage, token backfill, 나머지 coverage 기능군, 운영 backfill·재복사·복원 리허설·최종 전환.
- Do Next: coverage의 다음 기능군.
- Do Not: 운영 DB·키·배포·main/dev 직접 작업, 새 삭제 정책, 기존 namespace 자동 삭제/수리.
- resume action: start_next_task. 자동화는 PAUSED 유지.
