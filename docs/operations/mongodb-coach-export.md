# 코치 개인정보 내보내기 저장소 경계

`/api/coaches/export`는 실제 `assertCoachPiiAccess`를 먼저 통과한 뒤 `CoachExportRepository`를 호출한다. 기본은 Prisma이며 내부 요청 context에서만 Mongo shadow adapter를 사용할 수 있다. 요청값/header/cookie/env에 의한 backend 선택은 추가하지 않았다.

- 기존 phone/email/mail-merge 열, BOM, 따옴표/개행, 이름 정렬, 없는 링크 template의 빈값을 유지한다. 중복/없는/삭제된 코치는 내보내지 않는다.
- UUID는 소문자로 정규화한 뒤 중복을 제거한다. 잘못된 UUID나 고유 선택 20,000개 초과는 PG/Mongo 공통 400이다. 이는 기존 Mongo scan 상한과 맞춘 명시 경계이며 32MiB 내부 읽기 제한·운영 성능 검증을 없애지 않는다.
- CSV에서 공백 제거 후 =/+/-/@가 시작되거나 첫 문자가 tab/CR/LF인 값은 apostrophe를 접두해 스프레드시트의 수식 해석을 막는다. 국제 전화번호의 +도 문자열 처리되며 CSV 원문을 직접 읽는 소비자는 이 의도된 값 변환을 고려해야 한다.
- 응답에는 `Cache-Control: private, no-store`를 지정한다. 내려받은 CSV 자체는 권한 있는 사용자가 사용하도록 평문을 담는다. 저장 DB의 암호화와 다운로드 파일 암호화는 다른 범위다.
- PG는 선택 조회와 접근 감사 batch를 RepeatableRead transaction으로 묶는다. Mongo는 snapshot transaction 안에서 선택 코치→접근 감사→개인 프로필을 읽고 commit 성공 후에만 반환한다. 감사 한 건이라도 실패하면 선행 감사도 rollback되며 CSV를 반환하지 않는다. 이름/토큰은 Coach 선택 시 복호화되므로 모든 개인정보를 감사 전에 전혀 읽지 않는다는 보장은 하지 않는다.
- 요청 로그 best-effort 실패와 개인정보 접근 감사 failclosed는 구분한다. request 기록 실패 시 이미 성공한 export를 PG에서 재시도하지 않는다.

합성 OAuth 세션과 실제 권한 guard/withActivity/handler를 MongoDB 8.0.30에 연결해 무세션·비관리자·관리자 미설정 거절, 선택 밖 데이터 제외, UUID case와 중복, CSV 수식/캐시/template, 암호화 actor, 후행 감사 거절과 선행 rollback을 검증했다. 실제 운영 PG query·OAuth 로그인·브라우저 UI·실데이터 이전 검증은 아니다.
