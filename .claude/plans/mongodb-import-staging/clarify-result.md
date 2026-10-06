# 엑셀 staging 전환 범위

기준8e19638881581593a8c79660892ddbab364d1d25, 최신dev307f52f 포함·총괄 동일·작업tree clean 확인 후 feature/20260930-mongodb-import-staging 생성. clone은 /Users/ga/workspace/hub-om-mongodb-coach-content. 기존 계속 진행 승인이며 재승인 대기 없이 검증/독립검토/총괄통합/후속필수단위까지 이어간다.

요구: 현재 엑셀/CSV/JSON upload→staging→목록/상세 검토 흐름을 기본PG/명시Mongo로 보존. 기존 파싱, 중복·재실행, 오류행·원문 보존, 개인정보 암호화, 권한과 누락scope 차단. 승격/Calendar/Drive/잔존 Sheets·Notion 원천 호출은 후속 필수. 실제원천·운영/키env/배포/main/dev/원본workspace/자동화 변경 금지. 의존성/업무schema/삭제정책 추가 금지. 브라우저초안은 후속, 실제 이중독립백업/각각복원·전환후쓰기 보존 전 운영전환 금지.

실사용 코드근거: /admin/imports와 /admin/imports/[id]→PrismaImportRepository, ImportUploadPanel→POST/api/admin/imports/upload→storeParsedImport. 상세최대200행과 전체미연결행 승격은 구분. 페이지관리자/API workspace 권한차이 보존. 실활성빈도/외부cron 미확인, 미사용으로 제외하지 않음.

R1 다파일/테스트, R2 repository/context/원자성, R3 PG암호화정렬/동시중복 실제확인 필요, R4 사용자데이터/암호화, R5 원본PG oracle/실제handler 의미, R6 후속승격의진입점. 6축 Level3. 관련문서와 이전조사는 ../mongodb-dev-alignment/next-scope.md. 외부행동 결정 없이 합성코드개발 진행가능.
