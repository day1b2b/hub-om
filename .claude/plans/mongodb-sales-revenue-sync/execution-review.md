# 매출 동기화 실행 검토

기준 a52f191, 계획 v2/검증 v2. 제품 검증 및 독립 수락·통합의 상태를 구분한다. 전체 Mongo 묶음까지 실행 완료. 최종 독립 수락·정리·원격 통합은 아래 기록과 handoff/integration-review를 따른다.

## 실행 증거

로그 root: `/private/tmp/hub-om-sales-revenue-20260929/logs`. Node24.19.0, 실제 PG17.9/Mongo8.0.30, env-i 및 새 합성 키/loopback DB만 사용했다.

| 검사 | 확인 결과 | 증거 |
| --- | --- | --- |
| 일반 전체 | 910 pass / 57 skip / 0 fail, exit0 | unit.log; opt-in skip은 PASS가 아님 |
| 원본 PG/newPG/Mongo | 5 pass / 0 skip / 0 fail, exit0. 각 45상황×3단계=135 대조 | pg-parity.log; 최초33상황 실행은 pg-parity-first.log, 44상황 실행은 pg-parity-before-label-gap.log |
| 실제 GET/POST | 17 pass / 0 skip / 0 fail, exit0 | handlers-first.log |
| 실제 Mongo 신규 경계 | 28 pass / 0 skip / 0 fail, exit0 | native-final.log; 실제112/가상단조시간 기한/동일목표/snapshot/AAD 포함 |
| 원천·workflow·기본 알림 | 4 pass / 0 fail, exit0 | workflow-first.log 및 일반 전체 |
| typecheck/build | PASS exit0 | static 완료, typecheck.log/build.log; 추가test 뒤 typecheck-final.log, 마지막 T15 보완 뒤 typecheck-label-final.log exit0 |
| lint | 0 errors / 기존 7 warnings, exit0 | lint.log; 추가 native test는 lint-native-final.log, T15는 lint-parity-final.log exit0 |
| 전체 Mongo 묶음 | 577 pass / 0 skip / 0 fail / 0 cancelled, exit0 | mongo-bundle.log; mock 4개 포함, 490264ms |

개별 검사와 전체 묶음의 중복 테스트를 합산하지 않는다. 검증한 제품·test 17개 파일 digest는 본 계획의 verified-source-digests.json과 root 사본에 보존한다. 전체회귀 이후제품digest변경0, T15 test파일만바뀌어해당PG/type/lint재검증했다. 커밋전에다시비교한다.

## Validation v2 추적

| 기준/테스트 | 의미와 근거 |
| --- | --- |
| V1 T11 | 동결원본/newPG/Mongo의 미설정/reader disabled/failed/partial/정상/empty/실패/별도log실패를 각각 preview/apply/reapply 대조 |
| V1 T12 | 필터/null/정규화/키충돌/단일·다중동일·상이4mode/복수Course/미매칭과 500개상한. 실제 source의 딜중복/환불/빈금액/페이지는 unit 합성fetch |
| V1 T13 | ±반올림경계/지수/0·-0/0.1+0.2/최대/±반올림후초과/NaN·Infinity. 응답원number·rawString·정확저장·재실행 결과 독립 대조 |
| V1 T14 | 동일 Course 반복 및 역순 원천, snapshot before/중복 updatedRows·최종값·논리변경감사 비교. 같은 값 쓰기의 감사0과 원본 pending 유지 구분 |
| V1 T15 | source구간별복수Course multiset만 정규화. 최종fixture는서로다른회사/과정명·before값을갖는다. 각backend의실제조회반환을변경없이관찰/복사해첫매칭표시명exact검증후metadata2필드만backend간정규화한다. changes의이름·금액·action연결은대조에서유지. 정상handler표시명이름검사 |
| V2 T21 | 실제 updateOperation의분류·updateCell의매출 양방향경합에서실112/재조회/최신audit/무관필드보존 |
| V2 T22 | list후다른writer가revenue/raw모두목표로commit해도before/changed/updatedRows유지, 해당요청감사0. raw만다른경우감사1 |
| V2 T23 | same후수동변경/조회후신규Course/원천함수변경/행소실. 기존snapshot한계유지. Course+Company의 동일 snapshot도실경합확인 |
| V2 T24 | 중복pending의실112 후순서/감사edge 유지. 첫시도60초·재시도누적120초초과를가상단조시계로실현, 수동commit이후rawsnapshot정확보존. 실제벽시계120초대기는아님 |
| V2 T25 | 두번째업무쓰기후throw/두번째실auditinsert후throw/validator거부에서모두rollback, 별도sync/request/notify실패는업무유지 |
| V3 T31 | 실제GETPOST와실guard:403/400/200/500,secret/admin/잘못된bearer+admin,유효·무효resolution/잘못된JSON |
| V3 T32 | cronPOST미설정/미반영/오류만syntheticnotifier. 요청actor메커니즘·요약log실제actor보존,알림throw격리 |
| V3 T33 | 4필수서비스각각누락:PG/fetch0,source/업무/알림0. requestActivity는handler이전reject |
| V3 T34 | source/network/JSON/driver/주입오류는안전코드,knownissue공개문구보존,console/응답/알림/private저장원문0. 정상미리보기이름유지 |
| V3 T35 | rawactor/detail/changes암호화 및 독립createHmac정확대조,wrongkey/손상/AAD 인증실패·plaintextfallback없음. 공개Course읽기로키정당성증명불가,읽지않는이전log손상은업무차단안함. 키누락은업무0 |
| V4 T41 | a52f191 원본에서 IO만주입한oracle SHA 9940bbb0e5afa82e86725ef8309ad1f7b0f1b968478950f4a71a80ac0047b13a,새helper공유없음. 실제PG숫자probe별도증거 |
| V4 T42–T45 | 전체Mongo577pass확인. 독립최종수락·소유자원정리·feature/총괄원격확인은별도완료증거를추가한다. 일반skip57/파일패턴실제미실행과중복집계금지를명시 |

초기실패·수정은 gap-plan에 보존했다. 새로운 제품 변경 없이 검사를 반복하지 않는다. 신규 test의 type/lint 및 native 보완 검증은 변경 범위만 재실행했다.

## 남는 한계

생산기본PG. 전체앱/브라우저/운영PG18/실Salesmap·Slack/운영부하/실제복사·복원·최종전환/dev→main 미실행. 신규Course/코스ID이동/복원의동시phantom·수동매출우선권은원본한계이며새guard정책없음. 실제네트워크불명확commit은미검증, 오류알림은rollback단정금지. boundedscan초과는실패하며운영규모성능보장없음.

최종독립Turing V1–V3/실행검증수락 PASS, 미해결P0–P3 및추가필수test없음. 17/17파일digest일치독립확인. 소유자원정리cleanup exit0/남은합성DB0/정상종료및두dbpath부재확인. 원격T45는제품수락뒤진행하며integration-review에서최종확인한다.
