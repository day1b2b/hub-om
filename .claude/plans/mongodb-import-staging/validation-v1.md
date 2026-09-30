# Validation v1

critic Noether 독립 읽기 검토 결과가 회수 시 반환됐다. 아래 V1~V9는 메인의 세부 검증 매핑이며, 독립 critic의 V-1(PG의미), V-2(진입점/권한/개인정보), V-3(원자성/범위) 및 구조 FAIL 보완조건을 함께 적용한다.

S1 각Step 태그 PASS, S2 core존재 PASS, S3 FAIL: 동시중복 두 스케줄/200행 동률경계/관계null 대 손상/확정abort 대 불확실commit/공개오류allowlist/preview의정확한순서가 더 명시돼야 한다. 구조 FAIL시 결과기준 평가금지. 아래는 수락 판정이 아닌 검증 명세다.

| 기준 | 요구/위험 | PASS 조건과 실행 근거 |
|---|---|---|
| V1 파싱·HTTP | 현재업로드보존 | 실제POST 합성xlsx(첫sheet/헤더/date),CSV/JSON; 확장자/팀/default값/5MiB경계/빈파일·행/포맷오류를원래상태로판정. parser source변경없음. 비정형원문오류노출0 |
| V2 staging동등성 | 오류보존·재실행 | 원본PG/currentPG/Mongo: valid/invalid/mixed,업로드내중복,동일run원천재실행,newteam/name/type분리. 모든반환건수+전체run/row논리값일치; 저장0run도보존 |
| V3 암호화·오류 | 개인정보비노출 | rawrun/rows/requestaudits와저장실패응답/console에서합성private marker0; authorizedDTO는원래문자열복원. 잘못된키/HMAC/ciphertext/후반tamper시부분DTO/write0 |
| V4 조회의미 | UI/순서·200 | 원본PG와목록tie/UUIDdesc,상세sourceSheet localeCompareko+rownumasc,199/200/201,8/12preview·필수필드13번째,연결/미연결/softdeleted/null·오류행을대조. 정확동률은동순위집합허용,다른순위정규화금지 |
| V5 scope·권한 | PGfallback/권한확대 | 실제guard/workspace허용·거부/adminpage허용·거부,감사actor/requestid/status. imports/requestActivity/teamMembers/instructorNote각누락시쓰기0+PG0/외부0. 기본PG강제동작은local/env변수에도원래대로 |
| V6 원자성·재시도 | 부분실패 | runinsert후row제약/codec/강제실패rollback의raw전체일치. actualnative경합+driverretry필요시injection구분. 동시중복PG허용결과집합과재실행0행을검증하며글로벌once-only주장금지 |
| V7 준비·한계 | 자동수리/부분읽기 | unreadyvalidator/index/standalone명시거부,DDL/raw수정0. transaction기한/scan20k32MiB15s 초과는오류/부분write0; faultinjection과native를구분 |
| V8 승인경계 | 승격혼합/원천 | Mongo scope의미구현승격은PG진입전에거부,Calendar/외부0. 두원천모델변경감사0(기존제외),withActivity요청감사유지. Sheets/Notion의실원천전환완료로표현안함 |
| V9 회귀/인계 | 완결성 | 영향실DB→일반/type/lint/build/전체Mongo,독립리뷰Gap0,소유정리,최신devfetch/겹침/commitpush/양쪽SHA. skip과미실행PASS처리금지 |

원본freeze는기준8e19638 reader/writer와byte/SHA일치. 현재helper재사용금지. generatedUUID는실제유일성·참조확인후run/row대응값으로만치환; timestamp는호출시간범위확인후정규화,무쓰기전후raw는치환없이동일해야함. scalar/null/JSON순서·오류·건수는삭제정규화금지.

암묵가정: sourceSheet정렬은privacy wrapper의JS ko정렬,동시중복은run간unique없음,기본명단/강사는PG고정,요청감사는기본best-effort. 각각oracle·경합·factory/handler검증으로확인. 실원천/운영/백업/브라우저초안은이번검증밖이며완료주장불가.


## 독립 critic 필수 보완

- 두 upload가모두중복조회완료→각run/행저장허용. 첫commit이둘째중복조회보다앞섬→둘째run은중복count/log만추가. 전역once-only추가금지.
- 상세sourceSheet ko→숫자row순서후200. 경계동률은앞순위모두포함/뒤순위제외/동률집합에서잔여자리만중복없이선택.
- operationSessionId=null은미연결정상,nonnullFK대상부재/course/company손상은오류.
- 확정abort만raw전체동일; unknowncommit은전체없음 또는전체commit이며부분상태금지. 감사실패는기존best-effort로이미commit취소금지. 재요청중복run은원래허용.
- 고정오류는문구별명시allowlist(한국어판별금지). 비정형parser/driver본문·stack는응답/console로전달하지않는다.
- DTO필터→12개절단→변환,rowsnapshot추가8개절단,JSON배열/null/상태우선순위는byte고정reader를oracle로사용한다.
- 회계식 rowCount=storedCount+duplicateCount, errorCount=저장오류행수+duplicateCount, successCount=storedCount-저장오류행수. 원문/키·배열/로그순서를일괄정렬해차이를지우지않는다.
- 20k/32MiB는scan별,scan15s/transaction총기한/retry예산구분. Mongo연결준비는백업/운영성공증거아님.
- 독립검토자는 테스트/DB실행없음. 암묵가정·원본freeze/서버준비는실행증거로별도검증한다.
