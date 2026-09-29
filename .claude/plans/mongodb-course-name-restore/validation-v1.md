# 과정명 복원 검증 v1 — Anscombe

계획 적합, 구현/실행 수락은 별도.

- V1 기존PG알고리즘/hash bytes/명시db주입호환, explicit scope PG우회금지. 실제API403/400/413/409/500/200·32KiB·1~100unique·exactID·전체선택검증.
- V2 normalize courseId/기업/0회차과정/active세션/최신2source/blockedReason우선순위. 무효최신을과거로fallback금지. metadata충돌은선택전전체계획기준.
- V3 PGhash유지, Mongo논리hash 결정적/관련변경stale. 날짜/decimal/null/정렬정규화·암호문/companion/guard제외. backend간hash상호교환보장안함.
- V4 apply predicate읽기전동일tx nonce쓰기. GETguard불변. prepare만생성/open검사·자동수리없음. firstupsert경쟁/retry, 내부coordination추가와업무schema불변구분.
- V5 같은plan/서로다른세션/기존target재사용실barrier·한건성공후stale409. 다른기업포함계획도보호. counter/unique충돌의존없이guard효과증명.
- V6 기존target불변/newtarget company+name별1개·원본metadata·processSeq정상. selected연결/updatedBy/HMAC/updatedAt만갱신, 비관련raw/미선택/삭제/source/관계보존.
- V7 후행세션·감사실패→새course/선행이동/감사/counter/guard전체원복. retry중복없음·무효선택/stale부분성공없음.
- V8 실제selectedwriter중첩충돌/retry/snapshot재검증. 이미끝난source/course/unselected/newtarget변경stale. 미참여writer전체PGserializable동등주장금지.
- V9 101읽기/100선택·BSONshort·scan한도·누적deadline. 실제PG원본/newPG/Mongo·실guard/handler·fullregression·독립리뷰, 시간주입/실deadline증거구분.
