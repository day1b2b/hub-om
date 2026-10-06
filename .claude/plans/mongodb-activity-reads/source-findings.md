# 원본 코드 조사

Kepler 독립 읽기 조사, 기준39c70e2. DB 실행 결과가 아니라 설계 근거다.

- actorEmail contains/insensitive는 privacy wrapper가 후보 암호문을 복호화하여 JS lowerCase/includes로 비교한다. HMAC exact검색으로 대체할 수 없다. 일반 공백 email은 필터 없음, legacy 공백 email은 contains 빈문자열로 null author를 제외한다.
- legacy EDIT_HISTORY prefix/OR/NOT를 전체 의미대로 평가한다. source=legacy이면 tab=requests여도 legacy다.
- users는 ActivityRequest 원문 HMAC 그룹 수다. 대소문자·공백·빈문자열은 별도, null은 제외한다. 전체 인증으로 HMAC손상을 차단하는 Mongo는 기존 PG wrapper보다 엄격하다.
- cursor는 시각 DESC/UUID DESC 값 비교이며 cursor행이 없어도 계속된다. 느슨한 정규식을 통과한 잘못된 UUID는 PG오류503과 parser400을 구분한다. targetId는text, requestId는UUID다.
- admin requests만 monitoringRoutes 제외, feed는 포함. feed summary는 기간/email/actorType만 반영. usage human/automated에서 monitoring 제외, changes는 해당일 모든 user 변경.
- PG feed/usage RepeatableRead8초, admin목록/label은 독립읽기다. Mongo admin snapshot 보장강화와 scan안전한도를 기존PG와완전동일하다고 표현하지 않는다.
- PG private scan은 각 private필드 projection JSON32MiB/20k이고 공개 count/groupBy에는 해당한도가 없다. Mongo fullrow BSON32MiB/20k는 병렬검증상 추가안전한도다. 51개를 먼저 자른후private검색하면 누락되므로 금지한다.
- presentation은 현재 정보 우선, 없으면 redacted아닌 name/course_name/title fallback. 삭제코치이름유지/링크제거, Calendar operation_id로조회. 없어진최상위대상과깨진필수관계를구분한다. PostgreSQL UUID조회와 후속JS exacttargetId비교의 대문자 차이도 보존한다.
