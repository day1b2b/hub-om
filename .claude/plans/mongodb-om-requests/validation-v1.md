# Validation v1 — 메인 요구사항 초안, 독립 critic 보완 대기

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
