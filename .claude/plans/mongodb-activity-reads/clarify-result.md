# 활동 조회 전환 요구사항

사용자의 지속 진행 승인으로 공지·첨부 완료 다음 단위인 활동 관리 조회·피드·사용 통계 세 GET와 조회 표시 서비스를 전환한다. 기준39c70e25c482ee70089acbfb1c1f4b2c24cfc28e, feature/20260929-mongodb-activity-reads, 기존 격리clone재사용·시작clean. 기본PG와 명시Mongo context를 유지하며 운영선택을 바꾸지 않는다.

범위: api/admin/activity, api/activity-feed, api/admin/activity/usage. 기존 query/feed/usage/legacy와 presentation의 실제 필터·KST기간·cursor·정렬·50/51page·집계·관리자/Bearer권한·legacy코치콘텐츠·대상이름/링크/기록당시fallback을 원본PGoracle와 실제handler로 보존한다. 감사 쓰기/retention 정책과 UI변경은 범위밖이다.

Mongo는 fullcodec인증·조건별 안전후보/HMAC원문확인·snapshot·byte/row/time한도·부분반환없는실패·PGfallback차단을 제공한다. 개인정보 응답은 인가된 기존복호화계약을 보존하고 raw저장/감사/오류 평문노출과 구분한다. 새schema/의존성/권한/삭제정책 없음. 실PG/Mongo합성·전체회귀/type/lint/build·독립수락·소유자원정리·feature/총괄remoteSHA까지진행.

원본 workspace·운영PG/Atlas/실NotionGoogle·실키/env·배포·main/dev변경금지. 운영백업·범위·실행조건이 확인되지 않은 실데이터 작업은 진행하지 않는다. 자동화 설정은 변경하지 않는다. 저장된 hub-om 개발 heartbeat의 ACTIVE 상태를 읽기로 확인했으므로 과거 PAUSED 문구와 현재사실을 구분한다. 이것은 운영자동실행승인아니다.

R1 범위/인계, R2 필터·집계·표시교차, R3 PG개인정보wrapper 의미, R4 권한/복호화, R5 사용자조회동일성, R6 다중검증·연속인계=6; Level3. 기존 development-harness/validated-plan 절차를 재사용한다. 대안: route별직접Mongo분기는조건/권한중복위험으로제외, 좁은repository와기존파서/표시formatter재사용선호. 이메일 contains는 HMAC exact와 다르므로 원본wrapper를 읽고 후보복호화검사를 설계한다. 신규업무결정없음.
