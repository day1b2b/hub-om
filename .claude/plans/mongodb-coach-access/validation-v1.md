# 검증 기준 v1
S1 Core/Shell/Check 태그, S2 Core 1개 이상, S3 결과가 결정 가능한 규칙을 먼저 확인한다. 증거가 없으면 pending이며 mock을 실제 DB 검사로 세지 않는다.

1. 기존 query token 우선/Bearer fallback 및 공백 정규화를 유지한다.
2. 누락·오류·삭제코치 token은 인증 실패하며 실제 저장 token과 정확히 일치해야 한다.
3. /coach/me가 현재 name/status/workType 및 최신 완료 archive의 availability와 태그를 같은 DTO로 반환한다.
4. 본인 DTO에 token/phone/email/기타 archive 개인정보가 섞이지 않는다.
5. export 실제 권한 가드를 거치며 무권한 DB 읽기·접근 감사 0회다.
6. export type별 기존 CSV BOM/quote/열 순서/빈값과 코치 정렬을 유지한다.
7. 선택 ID 중복/없는 ID/삭제코치는 중복 노출이나 감사가 없고 타 코치는 포함하지 않는다.
8. export 접근 감사는 암호화하며 감사 실패 시 CSV를 반환하지 않는다.
9. 재발급은 권한 확인 후 token을 암호화 저장하며 old 거절/new 성공한다.
10. 재발급의 변경 감사 실패 때 기존 token과 감사 상태가 원복된다.
11. scope missing 서비스 및 오류 시 PG fallback 0회, no-context PG 기본 유지.
12. 실제 handler+합성 세션/native8과 mocked PG 대조를 구분한다.
13. 전체 테스트/type/lint/build 및 skip을 기록한다.
14. 운영 데이터/키/selector/배포 미변경과 미전환 경로를 명시한다.
15. 독립 review/manifest/alignment/handoff, feature commit/push 보관을 확인한다.
