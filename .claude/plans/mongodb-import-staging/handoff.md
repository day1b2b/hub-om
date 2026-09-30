# 파일 staging 전환 인계

## 현재 위치

작업 branch `feature/20260930-mongodb-import-staging`, 기준 `8e19638881581593a8c79660892ddbab364d1d25`. 별도 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`만 수정했다. lifecycle complete, Level3, artifact complete. 구현/검증/독립수락/소유정리/제품c11a05c의feature·총괄통합및양쪽원격SHA확인완료. 최종문서SHA는지속증거final-remote.txt를따른다.

## 이미 실행한 검사

- 원본PG/currentPG/Mongo 대조18pass. native30/handler16pass는전체Mongo에포함됨.
- 일반921pass/68skip/0fail, typecheck/buildPASS, lint오류0/기존경고7.
- 전체Mongo첫689pass/2fail/1cancel후실패3묶음103pass. 파일별최종중복제거751성공이며한번의전체실행751/0으로표현하지않는다. 실패는OM과거주소2건/coachContentroot240초1건. endpoint만명시추가했고업무assert/timeout완화없음.
- exact오류18사례, 실제PG×local/notion명단검증공백을보완해독립수락. 자세한한계는execution-review/independent-review.
- PG56729/Mongo27829정상종료, 소유DB0확인후정확한dbpath삭제·포트닫힘확인. 합성자원더없음. 지속로그는 `/Users/ga/.cache/hub-om-verification/20260930-import-staging`.

## 열린 항목과 다음 행동

Do Next: 최종문서원격SHA확인후별도promotion Task를계속한다. 사전계획은 `/private/tmp/hub-om-import-staging-20260930/promotion-plan`에 있으며 critic/meta의필수gap을plan-v2에반영해야한다. next-scope.md에후속실제경계조사가있다. 이미통과한검사를새실패/변경없이반복하지않는다.

Do Not: 원본oracle/parser/기존권한/업무schema/삭제정책/운영DB·실원천·키env·배포/main/dev/자동화변경금지. 기존namespace자동삭제/수리금지. 기능단위가끝났다고개발승인을다시묻고정지하지않는다.

## 범위와 한계

이번단위는파일업로드→임시저장→목록/상세검토다. 기본PG유지, 명시Mongo shadow만검증했다. 승격/실원천/Drive/Calendar/감사보존/backup-health/전체앱구성은별도후속이다. 실제브라우저미검증; 서버페이지함수/props는검증. 네트워크장애·standalone은실제서버재현이아니라명시주입검증이다. 실제백업/복원/운영전환증거0,dev→main조건미충족. 브라우저임시초안암호화는후속.

Alignment: update_next_task. Resume action: start_next_task.
