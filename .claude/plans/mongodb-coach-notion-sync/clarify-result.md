# Notion 코치 동기화 전환

실행 범위: 기존 Notion 원천/매핑·identity·행별 저장을 단일 workflow와 PG/Mongo adapter로 분리하고 실제 Notion/all handler를 명시 Mongo context로 검증한다. 기준 f8aac3e, feature/20260922-mongodb-coach-notion-sync. 원본 workspace·운영 DB/env/권한/main/dev/배포 변경, 실제 원천 호출, 새 의존성·삭제 정책 금지.

성공 기준: 실제 코드의 매칭/중복/삭제행/태그/employeeId/부분실패 계약, catalog→coach 잠금과 최신 재매칭, 원천 주입·PG 기본·scope 선행 검사, dryRun 무쓰기, 오류 비노출·개인정보 codec·감사 원자성, native 경합·전체 검사·독립 리뷰·문서/feature push/정리.

R1–R6: 다중 도메인·행별 실패·암호화 식별·동시 writer·외부 경계·인계 영향으로 Level3 유지. 범위와 실행 승인 명확, 새 정책 결정 없음. sourceEngagementId/sourceEngagementScheduleId 평문은 다음 필수 암호화 blocker이며 승인된 제외가 아니다.
