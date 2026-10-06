# 독립 검증 기준 v2 — Anscombe 최종 수락

읽기 전용 계획 검토이며 실행 PASS 아님.

- V1 context없음 PG기본, 명시 scope서비스누락/오류 fallback금지. 실제admin/withActivity·GET/POST응답·POSTbody미사용 유지.
- V2 onsite 미삭제 N/PARTIAL/UNKNOWN→Y, 완료/archive포함. onsiteText/updatedBy/그외raw보존.
- V3 OM 미삭제 ASSIGNMENT_NEEDED·omName notnull/notIn정확일치→ASSIGNMENT_PLANNED. null/empty/정확placeholder제외, 공백/패딩포함. trim/상태재계산금지.
- V4 PG HMAC notnull/notIn과 Mongo후보검색 대조. 후보복호화/HMAC/원문검증 failclosed; index제외손상행전수보장없음.
- V5 count업무쓰기없음, GET/POST별도snapshot·건수일치의무없음. 변화없는apply반복0·timestamp/감사추가없음.
- V6 business필드+updatedAt만부분갱신·감사동일transaction. 100개초과대상에서후행쓰기/감사실패시앞선raw/감사전체원복.
- V7 실제update/delete/coursebulk/두backfill겹친쓰기barrier·충돌/retry·조건재평가·유실/중복감사없음. 미래포함/모든순서충돌요구안함.
- V8 101/BSON짧은batch·scan한도/timeout부분성공금지. scan별/전체retry30초구분, 오류주입과deadline증거구분.
- V9 실제권한/scope, 요청감사선행설정실패/후행로그실패업무성공, 고정console/count·암호화감사actor. 내부activitycontext없는호출무감사기존계약유지.
- V10 원본PGoracle/newPG/Mongo독립fixture·각backend전후raw비교. 일반/static/broad/독립리뷰와skip/실패/인계별도판정.

Gibbs메타를반영한최종계획수락. V7 추가: 외부변경없이동일backfill선행실행이모든대상을처리하면후행은실충돌retry후0·감사중복없음. context없음PG/명시scope누락실패, OM목표ASSIGNMENT_PLANNED, 후행쓰기원복조건명확화반영. 실행판정은별도.
