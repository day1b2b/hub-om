# Google Sheets 가져오기의 명시 원천·저장 경계

두 기존 POST의 명시 source/context 연결과 합성 검증을 구현했다. 최종 실행·독립 수락·통합 여부는 `.claude/plans/mongodb-google-sheets-import/` 기록을 따른다. 기본 운영 backend는 PostgreSQL이며 실제 Sheets 접근이나 데이터 이전은 하지 않는다.

## 동작과 선택

- 기존 tabs/import route 및 HTTP helper의 공개 export는 유지한다. 현재 화면에서 이 API를 호출하는 경로는 확인되지 않았고, OAuth의 Sheets 권한도 요청하지 않는다. 이번 변경은 UI·권한을 활성화하지 않는다.
- scope 밖은 기존 Google HTTP helper와 기본 PG staging을 사용한다. `OPERATION_DATA_SOURCE=local/notion`이 기본 저장/명단을 바꾸지 않는다.
- 명시 scope에는 `googleSheetsImportSource`와 `requestActivity`가 필요하다. import에는 `imports`, `teamMembers`, `instructorNote`도 필요하며 원천 읽기 전에 모두 선택한다. 누락 시 외부 HTTP·PG로 넘어가지 않는다. tabs에 불필요한 저장소는 요구하지 않는다.
- scope는 인증을 부여하지 않는다. 실제 workspace guard·Google token 검사·withActivity는 그대로다. Authorization 헤더의 요청 감사 actor 분류와 route의 session 인증은 서로 다르다.
- 평가 순서는 기존대로 token → JSON → tabTitle/URL → 원천 → header/연도 parser → 빈행 검사 → sourceName/팀 → 저장이다. 명시 port 누락을 원천 전에 차단하는 점은 의도적 개선이다. 나머지 입력을 일괄 선검증하지 않는다.
- Google 조회 URL·범위 A1:ZZ2000·Bearer·응답 순서·기존 parser의 공백/행 번호/연도 해석은 그대로다. 원천에 쓰지 않고 자동 승격도 하지 않는다.

## 오류와 저장

두 route의 catch는 상태400을 유지하되 공개 가능한 정확한 고정문구만 반환한다. URL·권한·HTTP 실패 문구, import의 헤더 문구 외 Error.message/cause/stack은 응답에 넣지 않는다. 알 수 없는 오류는 각 route의 고정 실패 문구다. 기존 raw 오류를 그대로 공개하던 동작과의 보안 차이다.

저장은 기존 MongoImportRepository를 재사용한다. 같은 요청/과거 원천 지문의 중복·오류행 보존·run 생성·summary/detail의 의미를 바꾸지 않는다. 두 동시 요청이 지문을 모두 commit 전에 읽었으면 둘 다 저장될 수 있다. 새 unique/guard나 전역 exactly-once는 추가하지 않는다.

source/parser/명단 조회는 transaction callback 밖이다. 기존 드라이버의 transaction callback 또는 commit 재시도와 HTTP 전체 재실행을 구분한다. commit 뒤 오류가 발생했다고 저장0이라 가정하지 않는다. 요청 감사는 별도 best-effort이며 실패해도 성공한 업무 저장을 되돌리지 않는다.

기존 저장의 scan별20k/32MiB와 저장 호출60초 한계를 그대로 따른다. Sheets fetch까지 포함한 요청 전체 deadline이나 새 원천 timeout 보장은 아니다.

## 검증 범위와 미완료

원본 frozen PG·현재 PG·native Mongo 실제 handler의 전체 응답/저장/검토 DTO를 대조했다(각45개 내부 ledger, root1pass). auth/preflight/PII handler16, callback retry/commit ACK/rollback/중복 경합 native16, HTTP14, Calendar24도 확인했다. 일반971pass/86skip, type/build통과·lint기존7경고. 묶음/내부사례를 합산하지 않으며 전체Mongo 재실행은 아니다. 최종 독립 수락·소유 자원 정리·원격통합은 실행 문서를 따른다. 합성 transport를 실제 Google/OAuth 증거로 세지 않는다.

실제 원천 연결, Notion 가져오기, Drive CLI writer, 전체 요청·작업 조립, backup/health 및 실제 A/B 백업·복원·복사·전환은 별도 미완료다. 운영 설정·키·DB·main/dev는 변경하지 않는다.
