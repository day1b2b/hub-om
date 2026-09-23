# Handoff

- 위치: feature/20260922-source-identifiers-encryption, 기준 14cbf14(총괄 feature). 별도 clone. commit/원격 SHA는 최종 인계 메시지 참조.
- lifecycle: 요청 scope 구현·검증·독립 리뷰 완료, 총괄 feature에 fast-forward 통합 및 전체 회귀 재확인 완료(integration-review.md).
- 결과: 정책 26테이블/127필드, HMAC companion unique, migration `20260923090000_pii_source_engagement_ids`(운영 미적용), 계약 snapshot 재생성, Mongo 시트 HMAC 매칭+원문 확인, 이전 정책 namespace 거부(`applyMongoValidator`).
- 검증: execution-review.md. 격리 PG17·Mongo8.0.30 합성 검증, 전체 일반/타입/lint/build, 음성 대조, 독립 리뷰(P0/P1 없음, P2 2건 반영).
- open gap: 운영 PG migration·backfill·enforce, 새 namespace로의 실제 규모 export→import 재복사, 운영 규모 backfill 시간·잠금, 대형 컬렉션 prepare 스캔 시간.
- 전체 목표 잔여: runtime-coverage의 미전환 기능(관리자·가져오기·캘린더·공지·활동 등), 실제 복사·복원 리허설, 최종 전환, 브라우저 초안 암호화. 전체 암호화/이전 완료로 주장하지 않는다.
- Do Next: coverage의 다음 미전환 기능 전환, 운영 backfill·재복사 리허설 준비(백업·점검 모드 승인 필요).
- Do Not: 운영 DB·Atlas·실원천·키/권한/env·배포·main/dev·원본 workspace 변경, 기존 namespace 자동 삭제/수리, 새 삭제 정책.
- resume action: start_next_task. 자동화는 PAUSED 유지.
