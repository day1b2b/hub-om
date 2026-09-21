# 남은 차이와 다음 작업

| 항목 | 유형 | 다음 행동 | 머지 차단 |
|---|---|---|---|
| 브라우저 강의관리·종료회고·Drive 초안 평문 | 제품/구현 | 사용자 확정: 저장 위치/localStorage/보존·복구 유지. 오프라인 암호화·키 관리·계정 간 접근 보호는 추후 별도 검증 | 이번 서버 구현 차단 아님; 전체 보호 완료 주장 불가 |
| 격리 PostgreSQL 최신 migration/검색/정렬/백필/롤백 | verification | 승인된 별도 환경에서 실행; 현재 로컬 DB 실행 금지 유지 | 예 |
| 키 보관/복원/백필/제약/중단 전환/화면 | validation/배포 | 기술 책임자 계획·실행 검증 | 예 |
| 광범위 20,000행 초과 검색·정렬 | 제품/성능 | 기간/상태 후보 좁히기 또는 정확 검색. 필요시 token index 누출/비용 별도 결정 | 책임자 수용 필요 |
| 중첩 정렬·callback tx payload 및 여러 검색필드 총 비용 | 성능 | 실제 부하 측정, 요청 예산·projection 설계 | 책임자 수용 필요 |
| 나머지 직접 SQL CLI와 HTML export | 기술/업무 | 실제 사용 도구 우선순위 확인 후 repository 전환; 현재 안전 차단 유지 | 운영 사용 여부 확인 필요 |
| 과거 백업/WAL·외부 시스템·기존 export | 범위/운영 | 별도 보존/접근통제 정책, 이번에 수정/삭제하지 않음 | 전체 보호 완료 주장 차단 |
| 기업/과정명/도구 등 업무 문자열 개인정보 혼입 | 분류 계약 | 데이터 책임자 taxonomy 검토 | 예 |
| PostgreSQL 암호화 전환 vs MongoDB 이관 일정 | 운영 의사결정 | 공유 crypto/field policy 먼저 확정, 실제 전환 순서 결정 | 예 |

재개: docs/operations/personal-data-encryption.md → plan-v2.md → execution-review.md → alignment-review.md 순서로 읽고 승인된 검증 범위를 확인한다.
