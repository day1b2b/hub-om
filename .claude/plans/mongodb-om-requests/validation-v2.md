# Validation v2 — 독립 critic 보완 반영

계획검토PASS와 실제실행PASS 분리. 각 기준은 실제로그/테스트case/코드라인 근거 필요.

- V01 필수: 기준SHA와 원본fixture 고정, 생산 기본PG/local 유지
- V02 필수: list 날짜내림차순/get DTO·null/undefined 원본동등
- V03 필수: create 입력필드 제한·default N·생성ID시각·재제출 새요청
- V04 필수: update 입력field만·undefined무시·nullable정규화·메타보존
- V05 필수: delete 요청만물리삭제·operation/감사유지·없는요청false
- V06 필수: setOperationId/setSlackMeta truthy patch·없는요청null
- V07 필수: 명시scope PG/filefallback0·scope밖 원본유지
- V08 필수: 미구현배정preview/confirm/helper 명시scope거부·업무/외부0
- V09 필수: POST 저장후201·부수작업별best-effort
- V10 필수: POST 핵심저장실패500·후속0
- V11 필수: 날짜있는회차/실교육일/courseId/해커톤/보고서N 매핑동등
- V12 필수: 두번째회차/후속patch/대표연결실패시 기존부분성공보존
- V13 필수: 실PATCH 작성자/관리자·DELETE 미배정작성자/관리자 권한/status
- V14 필수: POST자체401추가없음·인증proxy전체미검증표시
- V15 필수: POST 필요한scope서비스누락 저장전거부·외부0
- V16 필수: PATCH 도구port누락 저장전거부·실행실패는성공유지
- V17 필수: 실handler/withActivity·요청log실패업무독립·기본PG재시도없음
- V18 필수: new/list/detail/edit/complete 서버page 합성port 실제조회·UIleaf만대역
- V19 필수: OmRequest/ActivityChange 보호field 암호문/HMAC·허용응답복호화구분
- V20 필수: wrongkey/손상/HMAC불일치거부·오류로그원문0
- V21 필수: Mongo 단일업무+감사원자성·DB/감사실패rollback
- V22 필수: 실Mongo메타/수정/삭제경합에서최신무관field보존
- V23 필수: 실PG 원본/newPG/Mongo 결과/행/감사대조·허용차명시
- V24 필수: Node24 env-i 일반/Mongo/static·skip과미실행PASS금지
- V25 필수: 독립리뷰/coverage/macro/handoff·소유합성정리·양브랜치원격SHA

범위밖: 실제로그인/브라우저전체/운영/실원천/배정Mongo원자성. 미검증표시.

## 독립 보완의 판정 규칙
Confucius 실제검토, 실행PASS아님.
원본파일/함수/SHA와정규화규칙기록(ID관계/감사batch/순서삭제금지).
실page지원의존성검증,미지원의존성은첫데이터접근전거부. TeamMember/Calendar전체전환으로확대금지.
필수port목록/조건부분기명시,실패요청log는업무/외부/fallback과별도집계.
경합은다른field보존/같은field원본허용결과구분,재시도가능오류만검증,새idempotency금지,배정경합후속.
허용응답합성PII긍정대조군+저장로그오류비노출;주입notifier허용값은누출아님.

## 메타보완
V06 truthy는Slack meta만;operationId setter는전달값그대로. V09/12 각부수실패의201+남은request/rounds/link+뒤쪽호출검증.
V22 실읽기barrier→경쟁commit→재개. 서로다른메타/입력field는둘다보존,수정↔삭제는한쪽notfound/거부또는수정후삭제순서허용하되삭제행부활금지. driver retry를실code112로관찰하고감사중복0.
V07/21/24 shadow/replica/준비상태gate와메서드전체deadline(재시도시재설정금지)연결.
V19/23 감사allowlist와귀속batch도동등. UUID/time생성값만정규화,같은ID관계/순서유지. 기존PG JSON의동일값암호화재작성 redacted감사는Mongo로직값비교와차이가능: 실제증거로확인하고차이는미리분류하되해소우선.
