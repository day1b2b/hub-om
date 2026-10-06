# Clarify — Drive CLI 이력 쓰기

사용자 계속 진행 승인에 따라 Notion 통합3c72e6997e057b7811e128e12ca6b354065de66a 뒤 다음 미전환 기능을 구현·검증·총괄통합한다. 작업 branch feature/20260930-mongodb-drive-import-writer, 격리clone /Users/ga/workspace/hub-om-mongodb-coach-content. 최신dev307f52f 포함, 원본workspace/main/dev/운영접근0.

목표는 기존 Drive dry-run의 운영대상 읽기→합성원천 scan/search→run/result 기록 경계를 명시Mongo로 연결하는 것이다. 실제 Drive나 업무 운영 필드는 수정하지 않는다. dry-run도 이력DB쓰기라는 사실을 유지한다. 기존조회facade/화면은 이미완료했으므로 반복하지 않는다.

성공기준: 원본legacySQL의 기존워크플로우 의미와 새encryptedPG/native의 run/result/summary·부분실패·concurrency를 실제DB·독립literal로 대조. 현schema에서원본guard가차단하는점/ID기본값제거를숨기지않는다. 새PG경계는안전한암호화repository로연결하고rawguard공통파일을우회/삭제하지않는다. 원천scanner기존의미 유지, 합성HTTP actualscanner연결별도검증. 운영table불변, 원문오류로그비노출, 전체검사/독립리뷰/소유정리/원격SHA확인.

제약: 신규schema/dependency/업무필드/삭제/unique/전역원자성정책0. 생산기본PG, Mongo명시context. 임시키/새loopbackPG/Mongo만. env파일/실원천/운영키/자동화 접근금지. 실제백업/복사/복원/앱전체조립/main병합별도미완료.

가정: --mode는기록용문자열이고동작변경없음, 전체실행transaction없음, result저장실패도catch에서errorresult재시도하며성공집계가이미증가할수있음. 실패를throw대신issues로돌려주는scanner로 인해completed/errors0이어도issues존재가능. 새정책으로고치지않는다. 외부예약실행은미확인으로남기며미사용이라고제외하지않는다.

R1~R6 모두해당: 다중계약/모듈,scope경계,조건분기,개인정보와부분쓰기,외부IO실패,실행증거인계. Level3 validated-plan, 현재계획/독립검토단계. 열린사용자결정없음.
