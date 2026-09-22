# 검증 기준 v2
구조 S1–S3 통과 후 아래 15개를 판단한다. native 미실행은 pending, 생산 전환과 합성 검증은 별개다.

1. query token 우선/Bearer fallback·trim 유지. 잘못된 query와 올바른 header가 함께 있을 때 임의 fallback하지 않는다.
2. 누락·틀린·삭제코치 token 실패, blind index 후보를 복호화해 원문 exact 비교한다. 암호문/HMAC/AAD 변조와 키 누락은 안전한 오류이며 인증 성공하지 않는다.
3. /coach/me는 최신 완료 snapshot만 채택하고 미완료/다른 schema/table/sourceCoachId archive를 배제하며 기존 태그와 DTO를 보존한다.
4. /coach/me 응답·오류·request 로그에 token/phone/email/임의 archive field가 새어 나오지 않는다. inactive/pending 정책은 기존대로 유지한다.
5. 실제 export auth guard에서 비관리자·세션 없음은 PII repository 호출 전에 실패한다. 저장소 context actor로 우회할 수 없다.
6. export은 기존 normalizedName asc 정렬, type별 열/BOM/quote/빈값/URLtemplate 누락을 보존한다. trimStart 후 =/+/-/@ 시작 또는 최초 tab/CR/LF 값은 apostrophe를 접두해 문자열로 처리한다. 공백 뒤 수식/국제전화 +번호/따옴표·개행 혼합 반례를 검사하고 값 변환을 명시한다.
7. 중복/없는/삭제 ID는 제외·정규화하고 선택하지 않은 PII는 반환하지 않는다. 잘못된 ID 및 상한 정책은 명시한다.
8. native export snapshot의 PII 조회와 접근 감사가 같은 transaction이다. 두 대상 중 후행 감사 오류 시 선행 감사 rollback 및 CSV 비반환을 확인한다. 원문 actor는 암호화되고 requestlog 실패 계약과 분리한다.
9. 재발급 권한 유지, 삭제/없는 코치는 PG/Mongo 모두 404로 차단한다. 기존 삭제코치 재발급 허용을 개선한 보안 변경임을 명시한다. 새 token과 index 동시 저장, old 거절/new 성공; 감사·오류에 token 원문 없음.
10. native 변경 감사 insert 실패 후 기존 token/index 및 감사 불변. 동시 재발급 최종 저장 token만 이후 인증되며 모두가 영구 유효하다고 주장하지 않는다. 삭제 경쟁에서 부활하지 않는다. 재발급 응답 이후 시작한 old-token 인증은 실패하되 이미 인증을 마친 진행 중 요청까지 소급 취소했다고 주장하지 않는다.
11. missing/throwing scoped service는 PG fallback 0회, no-context는 PG 유지. 실제 공유 tokenAuth 호출부의 미전환 경로도 PG guard로 차단한다.
12. 실제 route+실제 authguard/합성 세션/native8과 mock parity를 구분한다. OAuth/실제 PG query/운영부하로 확대하지 않는다.
13. 최신 전체 테스트·type/lint/build, 각 native 결과 및 skip을 따로 기록한다.
14. 운영 DB/키/환경/의존성/배포 미변경, backend 자동선택 없음. 미전환 coachMyPage·일정·섭외·운영복사/복구 gate를 명시한다.
15. 독립 계획·실행 review 및 manifest/gap/alignment/handoff를 확인하고 새 변경 feature commit/push SHA를 보관한다. 보관 절차와 코드 통과는 구분한다.
