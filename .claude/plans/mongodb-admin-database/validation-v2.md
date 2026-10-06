# 관리자 DB 검증 v2 — Anscombe

독립 정적 검토. 구현·실DB 실행 수락 아님. 계획Core3개와Shell/Check태그 존재, 조건부변환규칙 확인. 구조FAIL이면결과검증하지않는다. 조회공통presenter·편집부분쓰기·page adminDatabase/teamMembers 경계필수.

V1 context밖기본/backend보존,명시scope누락/실패fallback금지. 실제권한redirect와readonly403구분. malformedJSON400/JSONnull기존예외/P2025=404/P2002=409/기타500·문구보존.
V2 8표순서/count/total/title/href/cells/options/tone/rawValue 원본일치,deleted포함/실관계존재,MemberlatestActivity는정렬첫행,generatedAt제외,Decimal0보존.
V3 0/99/100/101정확sample100/BSONshort,Member isActive desc/displayOrder asc NULLS LAST/updatedAt desc,완전동률_id허용,정확count,한도초과부분응답금지.
V4 SQLnull/JSONnull/빈object-array/scalar요약·tone/UTCdate/서울datetime. scalar원문표시는기존정책. nullable연결null미연결/non-null깨진연결failclosed구분.
V5 기존trim/boolean/enum/Number integer-money/쉼표/date파싱. Int32/null·decimal반올림양음수/overflow실PG대조,courseId null DB거부유지,날짜rollover/기간역전새정책금지.
V6 Company/Member name+normalized/HMAC,OperationSession만updatedBy,deleted행편집유지. Company/Course/Member복합unique와MemberNULL중복허용. 비관련cipher/관계보존,derived업무필드추가갱신금지.
V7 동일값updatedAt/감사PG대조,Member감사공개role/sourceTeam만추가. 감사실패전체업무/HMAC/timestamp/actor원복. request감사미설정선행차단/후행실패업무성공. 키/HMAC/원문변조failclosed·저장로그PII/driver원문금지. 기존409입력명반영응답은보존.
V8 operation/course/Memberwriter와같은행같은/다른필드·삭제·unique경합barrier실검증. conflict/retry·최신부분쓰기·감사중복/필드유실없음,삭제후편집정상직렬상태허용. 모든순서충돌/승자고정요구안함.
V9 actualauth/withActivity/actor/context·page두repository주입으로PG/local우회없음. storedfactoryscope기본/누락구분. 일반getTeamMemberRepository Notion정책미전환명시또는별도검증. table기본/배열/무효/빈·columns/Gridprops/조건panel유지.
V10 원본PGoracle/newPG/Mongo+독립기대값. backend별raw전후비교/무작위cipherbackend간같음요구안함. 전체retry30s/개별조회한도,가상시계와실deadline구분. PG16독립query/Mongo단일snapshot차이명시. native/handler/page/test/type/lint/build·독립리뷰·실패skip구분·cleanup/commit/push/통합별도.

권한/backend우회·Membernull정렬/unique차이·범위밖갱신·PII/HMAC·감사비원자·값유실·필수검사미실행은차단. 업무schema/의존성/권한/삭제정책/운영변경금지.

## 메타 보완과 최종 기준

V1 추가: 4표rowId는PG UUID입력계약. uppercase/compact/braced/매4자리선택hyphen허용표기·무효형식·정상부재를실PG대조한다.
V10 추가: 원본dashboard의query뿐아닌formatter/DTO생성전체byte동일fixture. oracle에새presenter공유금지,8표고정기대값독립대조.
S3/V9 명확화: teamMembers는getStoredTeamMemberRepository만scope우선선택. 일반factory는기존Notion정책유지·미전환명시.
Anscombe 최종기준수락: 구조PASS, 위보완을v2에반영하면실행가능. 구현/실DB실행은별도수락한다.
