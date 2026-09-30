# 후속 운영 승격 — 범위 확인

상위 목표: 기존 기능·권한·개인정보 보호를 유지한 Mongo 이전. 사용자의 계속 진행 승인은 개발·합성 검증·feature/총괄 통합에 유효하다. 운영·실원천·키/env·배포·main/dev/원본workspace 변경은 하지 않는다. 브라우저 임시초안은 별도후속이다.

선행 파일 staging/검토는 별도Task의 최종회귀 진행중이다. 이 문서는 후속사전계획이며 구현 시작은 선행총괄통합후 별도 feature/20260930-mongodb-import-promotion에서 한다. 기준SHA는 그때고정한다.

이번범위: admin imports promote POST→전체미연결 원천행의기업/과정/운영생성·매칭·복원·원천연결·변경감사와 commit후Calendar backfill의명시부수작업port. 기본PG·기존권한·요약결과를유지한다. 실Calendar 구현은다음전용Task지만 이번API는누락scope를쓰기전에차단하고합성effect로commit후호출/실패격리를검증한다.

R1~R6 모두: 다파일/원천의미/transaction·암호화/데이터유실/권한·외부효과/검증·상위계획영향. Level3. development-harness→validated-plan의작성·독립검토분리를이어간다. 새로운의존성/업무schema/삭제정책없음. 실행승인재질문없음.

선행통합완료: 75125c9644d6c8265fbdae59e5c9d450247170ef. 현재위치 feature/20260930-mongodb-import-promotion, 시작시clean, 원본fixture byte/SHA고정. source-only 조사중잘못추정한파일명은수정했고실제경로는importPromotionService.ts다.
