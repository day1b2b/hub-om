# 활동 조회 검증 v1 — Anscombe

구조 S1 6단계 Core4/Shell1/Check1태그 PASS, S2 Core존재 PASS, S3 공개필요조건→전체인증→조건평가→정렬/51선택과조건별실패프레임 PASS. 실행PASS아님. 구조FAIL시결과평가중지.

V1 실제3GET·실제admin guard(세션만stub)/비관리자403,feed정상Bearer/잘못401/키없음·32미만503;인가가파싱/조회선행. parser400/repo503문구·헤더유지. defaultPG/명시Mongo/누락scope·오류시PG외부fallback0. 없는withActivity/retention추가금지.
V2 39c70e2 query/privacy/labelformatter독립oracle,새adapter/presenter공유금지. 원본PG/newPG/Mongo합성fixture전체DTO대조,Date/null/undefined·summary미요청생략. fetchedAt만요청시각범위검사후정규화. 실제응답HMAC/암호화companion0.
V3 일반공백email무필터/legacy공백contains빈값null제외,privateJS lowerCase/includes와공개routePGLIKE%/_/escape실PG대조. 51후보밖private일치포함,OR/NOT과도축소금지. KST반개구간/날짜·기간오류/feed기간·fromuntil덮어쓰기·2048경계/usage30일양끝. 0/49/50/51·동률UUIDdesc·삭제cursor누락중복0. UUIDparser400/DB503구분,targetIdexacttext.
V4 adminrequests만monitoring제외/feed포함. feedsummary기간/email/actorType만,cursor/action/target/route/errors와독립. usage human/automatedmonitoring제외·userchanges전체. users인증된원문HMACnonnull distinct,case/space/empty별도/null제외,독립count기대. legacy source우선/EDIT_HISTORY/prefixORNOT/지원안되는조합빈결과.
V5 operation/company/course/coach/content/engagement/calendar/미지원대상. 현재우선→name/course_name/titlefallback,after→before,redacted제외,빈문자열??/truthy차이. 삭제코치이름유지링크없음,Calendar operation_id/URLencode. UUID조회와JS exacttargetId별도/uppercase동작보존. 반환50행대상만조회,최상위소멸fallback/필수관계손상safe실패(Mongo단독).
V6 fullrowcodec인증후평가. 키없음/오류/HMAC/암호문JSON손상부분반환금지. 인가복호화응답과raw저장/로그/오류평문금지구분,고정safe오류/driver원문없음. 미지원조건무시금지.
V7 method snapshot·retry밖고정8초. 실제writerbarrier로feed목록summary/usage집계/admin목록labels혼합없음. scan별후보32MiB20k15초와남은총기한중빠른한도,인증후정렬51. 실제BSONshort/다중batch/실마지막_id/noGetMore/누락중복0. 한도계측주입허용하되실제경계미실행명시,가상시간과실retry증거구분. codec/정렬/집계/formatter후기한확인,8초엄격벽시계보장아님.
V8 open은shadow/replica/validator/index검사,무수리/DDL없음. 정상·실패조회raw변경0. 원본PG/newPG/native/실handler/전체회귀/type/lint/build근거연결,실패skip미실행PASS금지. 정리/push/remoteSHA/통합별도인계.

Baseline: PGfeedusageRepeatableRead8초/admin행label별도, Mongo admin snapshot강화. PGprivateprojectionJSON와Mongo전체BSON한도차이,PG공개count무한도대비Mongo더엄격한503명시. 이번구조수락,공개51선절단/30초확대없음.
