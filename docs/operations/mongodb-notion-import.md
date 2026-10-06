# Notion 가져오기의 명시 원천·저장 경계

개발·합성 검증과 소유 자원 정리를 완료했다. 최종 수락·정리·통합 상태는 `.claude/plans/mongodb-notion-import/` 기록을 따른다. 이번 범위는 기존 POST `/api/admin/imports/notion/import`이며 과거 제거된 Notion 일정 화면/자동 원천 연결을 되살리지 않는다.

## 유지하는 계약

기본 원천은 기존 readNotionDatabaseImport, 저장은 PostgreSQL이다. 명시 context에서만 NotionImportSource와 기존 imports/명단/requestActivity를 사용한다. source/read port는 인증이나 token 설정을 부여하지 않는다. workspace guard, 서버 공용 NOTION_TOKEN??NOTION_API_KEY, 팀별 ID/URL 선택은 기존 순서대로 유지한다. 빈 TOKEN은 API_KEY로 넘어가지 않으며 임의 trim/새 기본값을 추가하지 않는다.

명시 import scope의 원천/저장/명단 port는 원천을 읽기 전에 해석한다. 누락 시 외부 HTTP나 기본 PG로 넘어가지 않는다. 기존 env 읽기까지 제거한 것으로 표현하지 않는다. 새로운 tenant별 credential 모델이 아니므로 A/B scope 검증도 불변 합성 서버 token 하나를 사용한다.

원본 reader는 모든 page를 읽은 후 property 매핑/JSON parser를 실행한다. 후속 page 실패 시 앞 page를 부분 저장하지 않는다. property alias 우선순위와 first title fallback, 날짜 앞10자리, 이름 합치기, formula0/false, NOTION-pageID를 유지한다. 기존 reader가 변환해 남긴 한국어 키 행을 staging에 보존하며 원본 Notion page의 모든 property를 보관하는 계약은 아니다.

HTTP rowCount는 읽은 page 수, run.rowCount는 validated row수, storedCount는 중복을 제외한 수다. 이 값을 서로 대체하지 않는다. 기존 sourceType notion/sourceSheet Notion/result.databaseId/팀/sourceName에 따라 같은 staging과 검토 DTO를 사용한다. 자동 운영 승격이나 Calendar 반영을 추가하지 않는다.

## 오류와 실패 상태

URL/ID 오류와 권한 오류의 정확한 고정 문구만 catch 응답으로 허용하고 그 외 Error.message·statusText·cause·stack은 고정 실패 문구로 바꾼다. 기존 raw 오류 공개와 의도적인 차이다. token 설정/URL 누락/빈 원천의 기존 고정 응답은 유지한다.

저장 전 실패·confirmed abort는 staging 불변, 실제 commit 후 응답 확인 오류는 전체 저장 유지, 미확정 commit은 별도 관찰로 판정한다. 감사는 별도 best-effort라 실패해도 성공한 업무 commit을 되돌리지 않는다. transaction callback/commit 재시도로 pagination을 다시 시작하지 않는다. 기존 동시 중복 처리 의미를 유지하며 새 unique나 전역 exactly-once는 추가하지 않는다.

기존 reader에는 새로운 pagination 상한·cursor cycle 차단·timeout·retry를 추가하지 않는다. 저장소의 scan별20k/32MiB나 store60초를 Notion 전체 요청 기한으로 해석하지 않는다.

## 검증과 미완료

합성 raw HTTP→실제 reader/parser 46개, actual handler15개, native transaction17개, 원본PG/currentPG/native actual POST→저장/검토 각47ledger를 검증했다. 일반1017 PASS/89 opt-in skip, type/buildPASS, lint기존7이다. 검사별 중복 건수를 합산하지 않는다. 임의 parsed stub만으로 원천 변환을 검증했다고 하지 않는다. 실제 Notion/OAuth/UI·운영 데이터 검증은 범위 밖이며 새 테스트 작성만으로 PASS를 선언하지 않는다.

Drive CLI writer·전체 앱/작업 조립·backup/health·snapshot 개인정보 분류·운영 PG collation·실A/B백업/각복원/복사/운영전환이 남아 있다. 운영 기본PG, 실백업증거0, dev→main 조건미충족 상태를 유지한다.
