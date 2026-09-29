# 활동 조회 실행 증거

Level3 R1–R6=6,plan-v2/validation-v2구조독립수락완료. V1–V8 실행수락은미완료.

main query/select/트랜잭션·권한·parser/headers를유지한경계작성. 최초typecheck-boundary는adminList의조건분기에서TypeScript가rows union을좁히지못해실패했다. requests분기의고정query반환을ActivityRequestRow로표기하고런타임동작그대로보완. 후속검사결과는추가기록한다.

새소유PG/Mongo setup exit0. 다른프로세스/실DB접근없음. 최종실검사/리뷰/정리/push/통합미완료.

main boundary.log 10pass/0skip/0fail와 typecheck-boundary-fixed exit0. Gibbs main 경계 독립 리뷰 P0–P3 없음: PG query/transaction·권한/파서/503/headers·순수formatter분리·기본PG/직접PG차단 보존. Mongo 및 실DB/실handler 수락은 별도다.

## 최초 실제 검사와 보완

native.log 30pass/0skip/0fail exit0. private prefix·literal/LIKE·fullrow/companion·label·3메서드 실제 별도 writer snapshot·실BSONshort/101행·주입 한도/가상8초·주입 transient에 대한 드라이버 retry·open 무수리 검증.

handler1차 8pass/2fail(실패 child와부모). Company.name은 기존 개인정보 inventory에서 operational인데 테스트가 private로 취급해 raw비노출을 잘못 기대했다. fixture표시명과 기대를 바로잡고 actorEmail/actorName/changes JSON의 비노출은 유지했다. 공개 company 저장 positiveassert를 추가했다. 손상 fixture는 의도적 plaintext 주입에만 bypassDocumentValidation을 사용한다. handlers-second.log 10pass/0skip/0fail exit0.

PG1차 pg-parity.log 2pass/1fail: CoachEngagement의 @db.Date에 KST구간경계15Z fixture를 넣어 Mongo codec INVALID_DATE. 날짜 필드만UTC자정으로수정하고 활동 시각/KST조건은유지했다. pg-second.log 6pass/0skip/0fail exit0. 원본PG/newPG/Mongo각81상황과raw불변대조통과. 독립oracle해시cf8222d43e906f15360ac07dd0632b20836db2877a8a8c188bc280a3c0ddd4cc유지.

일반 unit.log 901pass/51skip/0fail exit0. 전체 lint 0error/기존7warning. 최초 전체typecheck/build는PGoracle의조건분기반환union을새repositorytype에강제대입한테스트타입오류로실패했다. oracle는변경하지않고테스트변수의명시타입을제거하여원본추론을유지했다. 런타임/기대값변경없음. 후속typecheck/build·해당testlint실행중.

초안코드리뷰에서legacycontent의암호문regex후보검색을제거하고복호화literalprefix로수정했다. 공개route의JS재평가는Unicode DP로변경했으며서버후보regex는남은maxTimeMS로제한한다. Gibbs main/최종제품중간review P0–P3확정지적없음,최종V1–V8수락과전체Mongo회귀는진행중.

typecheck-final/build-final/lint-pg-final exit0 확인. 제품 코드 변경 없이 oracle 테스트의 타입 추론만 바로잡았다. 최초 static 실패와 최종 성공은 분리 기록한다. Gibbs가 PG/handler/native로그와 독립oracle를 직접 대조하여 V1–V7 PASS, 추가P0–P3없음으로수락했다. V8은 전체 회귀 결과를 기다린다.

재시도 증거는 주입 transient 오류를 실제 Mongo driver가 재시도한 것이며 실제 서버 쓰기 충돌이라고 표현하지 않는다. snapshot은 별도 writer의 실제 커밋으로 검증했다. 실제 32MiB/20k 모든 경계와 실8초대기는 미실행, 계측 주입과 가상시간을 구분한다.

## 재현 환경과 명령

Node24.19.0/PG17.9/Mongo8.0.30, env-i로시작하고명시loopbackURI/임시키/합성fixture만사용했다. 로컬로그와실행스크립트는 /private/tmp/hub-om-activity-reads-20260929 에보존한다.

일반·정적명령은 npm test / npm run typecheck / npm run lint / npm run build. 실제DB검사는 node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test 에 PG/native/handler 파일을 각각지정했다. 전체Mongo는 --test-concurrency=4와 src/lib/data/mongo*.integration.test.ts, src/lib/data/mongoTeamMemberRepository.test.ts, src/lib/data/teamUsers/mongoTeamUserRepository.integration.test.ts를사용한다. DB정리대상은정확한소유dbpath만이며검사별namespace는각finally에서정리한다.

## 최종 수락·정리

전체 mongo-bundle.log 497pass/0skip/0fail/cancelled0 exit0(319.45초), mock4포함. 일반901pass51skip, PG6/native30/실handler10은중복묶음이므로합산하지않는다. typecheck-final/build-final/최종대상lint exit0,전체lint0error/기존7warning. Gibbs가로그와코드를대조하여V1–V8최종PASS,미해결P0–P3없음으로수락했다.

cleanup exit0. 소유Mongo replica/dbpath확인후남은합성DB0,PG/Mongo정상종료,두소유dbpath제거/부재확인. 로그·스크립트는보존했다. 운영·실원천·실키/env·권한·배포·원본workspace변경없음. featurepush/총괄통합·원격SHA는integration-review에서확인한다.
