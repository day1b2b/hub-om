# Google Sheets 가져오기 Mongo composition

2026-10-01 기준 `/api/admin/imports/google-sheets/tabs`와 `/api/admin/imports/google-sheets/import`에 기능군 backend selector를 연결했다.

- 기본값과 `postgres`는 기존 PostgreSQL repository와 Google Sheets reader를 그대로 사용한다.
- 정확한 `GOOGLE_SHEETS_IMPORT_BACKEND=mongodb-shadow`에서만 Mongo shadow를 연다.
- tabs는 `googleSheetsImportSource`, `requestActivity`만 연다.
- import는 `googleSheetsImportSource`, `requestActivity`, `imports`, `teamMembers`, `instructorNote`를 한 잠금 scope로 연다.
- URI·database·namespace·암호화 키를 업무 처리 전에 검증한다. 잘못된 selector, 불완전한 설정, 부분 namespace는 PostgreSQL fallback이나 자동 수리 없이 고정 오류로 종료한다.
- production 요청 경로는 준비 함수를 호출하지 않는다. 별도 준비 절차로 완성된 namespace만 연다.

기존 URL 파싱, Google 응답 처리, 표 정규화, staging 저장, 권한과 승인된 응답 계약은 변경하지 않았다. 합성 Google HTTP와 로컬 MongoDB replica set으로 tabs 최소 scope, import 저장, 요청 감사, 암호화된 sourceName, PostgreSQL 무접근을 확인했다. 부분 namespace는 tabs/import 준비와 실제 route 모두 거부하며 validator·index·행을 바꾸지 않는다.

실제 Google Sheets, 운영 PostgreSQL·Atlas, 운영 키·환경·배포 설정에는 접근하지 않았다. 생산 기본 backend는 PostgreSQL이며 실제 원천 검증, 운영 데이터 복사·복원 리허설·최종 전환은 남아 있다.
