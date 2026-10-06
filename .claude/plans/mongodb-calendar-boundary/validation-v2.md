# Calendar Validation v2 — R1~R6 / Critic P1·P2 / PII 보완

대상: plan-v2의 단일 수직 단위. v1은 보존하며 이 v2가 검토 기준이다. 아래 상속 ID는 후반의 세부 시나리오로 구체화했고 상충하는 포괄적 기대값은 제거했다. 현재는검증설계만작성했으며새코드·DB·테스트·외부실행없음. 선행 promotion 제품·독립 수락·합성 정리는 부모 전달 완료다. 부모가 제품504782b9f69a921df7b6ec1422dcf103514494e7·통합/두원격8238647961bebe3545128fc95f017881ace7d404와 clean을 직접 확인했다. Calendar 새 branch와 원본919파일 snapshot을 준비했다. 선행 PASS와 Calendar 실행 증거를 분리한다.

## 1. 판정 원칙

1. 원본 PG 보장은 session 살아있는 동안의 잠금과 협력적 abort다. 잠금손실후 Prisma/Google 효과잔존을실패로단정하지않는다. Mongo lease가장기정지에도만료되는차이와mapping fencing강화는명시대조한다.
2. 실제원본함수/PG adapter, 실제nativeMongo, actualPOST/withActivity/guard를독립적으로검증한다. 신규core/adapter를원본oracle에공유하지않는다.
3. 응답과저장상태와외부호출은별개oracle다. HTTP200안의failedOperations, HTTP400인데승격commit유지, mappingcommit불명, release실패를각각판정한다.
4. native경합/connection termination, driver ACK오류주입, clock주입, 합성transport를구분표기한다. mock으로만든112를native경합증거로쓰지않는다.
5. mapping보호만검증하고운영전체fencing/Googleexactlyonce를주장하지않는다. DB retry와외부callback retry를분리해후자는항상0을검증한다.
6. 필수native/PG suite는전용opt-in없으면skip가능하나수락증거가아니다. 부모가전용endpoint를공급한검증에서는필수시나리오0skip이어야한다. 미실행/환경실패를PASS로적지않는다.

## 2. 원본 추적성·동결

최종 기준 HEAD는 `8238647961bebe3545128fc95f017881ace7d404`다. 아래 표는 과거 조사 시점 digest이며 실제 원본 전체는 `/private/tmp/hub-om-calendar-boundary-20260930/original`의919파일과 original-digests.json으로 동결했다. 각 oracle resolver의 의존 폐쇄와 공유 허용 여부는O1~O4에서 별도 검증한다. 선행 원격 증거는 cache의 final-remote.txt다.

| 파일(root=src/) | SHA256 |
| --- | --- |
| lib/googleCalendar/calendarOperationLock.ts | 3275fc9f02509a07581b9b37a8d7b408ec39da745b8d8bac68855ca3bfdb6c8f |
| lib/googleCalendar/calendarEventLinkRepository.ts | 1d2a901121a5ca3b55e9d316507975d797218f6e8641e1f49cbf2dce9b9c0692 |
| lib/googleCalendar/operationSessionTimestamps.ts | 843116741b5a74fd30382c2cc36db61798f345728f756a39eef1fcfb642aa568 |
| lib/googleCalendar/backfillCalendarEvents.ts | 5af428adfa1c81f680db2d088ebb7cb00ae6e28737b81fdbe622aa2e834dcaaf |
| lib/googleCalendar/backfillCalendarEventsRules.ts | 5aedbc7c1e40d14734cde2c333de0bcfb4c0600f6a4670c8d3e20937b4100878 |
| lib/googleCalendar/calendarWriteClient.ts | 872722f95038e6fa219f5a72316ec596c77bcfb1fecae3c3eca54d8e9e44e3de |
| lib/googleCalendar/reflectOperationToCalendar.ts | 22cad0c6c025490b9a59c987fae0cfe20bc5288603a156eb7cf27b8de12fe9cb |
| lib/googleCalendar/applyCalendarReverseSync.ts | b85955428c451a12161ef229663873844094cb9d9c39916f85ee1a4621caa99b |
| lib/googleCalendar/cleanupBackfilledCalendarEvents.ts | 9670705b33be45a38af7495354eab4bdc845baecee01955afc5e090169635c46 |
| lib/googleCalendar/refreshCalendarEventTexts.ts | 8d9cd3eb58ca26cd7adfc1b72dc02520f9d54673d581b76f42c1bec7a45e769c |
| lib/data/calendarReflectingOperationRepository.ts | 3e52c068cf224b1ac2f9d8176c780709f6ec02f67b1d33c8dc8b9f2161080527 |
| app/api/admin/imports/[id]/promote/route.ts | d8a4ea27003ca1834fba3d867775b4e2ffc7f6071428540ed8f6e4656ad0c0c9 |

追加동결대상은 calendarReverseSync/rules, operationCalendarEvent, calendarParticipants, calendarWriteConfig, cleanupToken, notifyCalendarReflectSkip, 관련API3종, privacy/activity정책과PGtrigger다. 이들의digest는다음구현시부모가manifest에추가한다. 현재표에없는digest를확인한것처럼주장하지않는다.

original dataURL 실행시두가지이상을혼동하지않는다: 원본코드는그대로두고resolve hook에서파일URL parent를부여하며필요한합성외부경계만redirect한다. 실제PG대조에서는getPrismaClient/trigger를mock하지않는다. 경로·SHA·fixture ID·test명·로그위치를최종증거표로연결한다.

## 3. 격리 실행·외부 차단 설계

- 미래부모전용env 제안: `MONGODB_CALENDAR_TEST_URI`, `PG_CALENDAR_TEST_DATABASE_URL`. loopback만허용하고credentials/DB이름/replicaSet/port를검증한다. 기존promotion27839를묵시재사용하지않는다. 실제 소유 endpoint는PG56749/calendar_boundary_parity, Mongo27849/replica calendarboundary20260930이다.
- 매suite random소유DB/namespace, 임시PII키, 합성TeamUser/Operation/source/mapping/Google event만사용한다. 운영URI/.env/실원천을읽지않는다. finally는소유가확정된자원만정리한다.
- 테스트의실제calendarWriteClient를유지하고fetch transport만OAuth token endpoint·Calendar API 합성응답으로바꾼다. 요청body/URL/query/headers/signal/횟수/순서를기록한다. 허용합성endpoint 외는즉시tripwire실패. 실제DNS/네트워크는하지않는다.
- OAuth는가짜자격증명과가짜token/cache reset으로검증한다. 실제refresh token/access token이필요하지않다. Slack fetch transport만 합성하고 실제 notifyCalendarReflectSkip→sendSlackDirectMessage 하위 catch까지 확인한다. 송신함수 전체 mock으로 PII 로그 표면을 가리지 않는다.
- PGfallback검증은원래assertDefaultDatabaseAccess/getPrismaClient를유지하고그아래PrismaPg 생성및pg.Pool 연결을각각계수한다. PGoracle suite와Mongo fallback0 suite는모듈/mock간섭없이별도프로세스로실행한다.
- mock.module지원Node24/기존ts-loader와handler의next/tsx resolve 패턴을쓴다. 필요한원본dataURL의남은next/alias는실제파일parent로resolve한다. hook으로실제권한/withActivity/업무repo를대체하지않는다.

## 4. 원본·PG·Mongo 대조 매트릭스

| ID | 계획/원본함수 | fixture·관찰 | 필수판정 |
| --- | --- | --- | --- |
| P1 | §3 mapping 8개메서드 | 신규/같은값upsert/교체/날짜이동/조건부삭제/없는키/전체삭제/정렬 | 응답·logical값·createdAt보존·updatedAt·원본일치조건 exact; 이동0건오류/목적지unique실패 |
| P2 | schema/privacy/PGtrigger | calendarId/eventId 암호화·HMAC조회·두동일eventId역조회·raw스냅샷 | 새로운unique없음; mapping+감사atomic; 감사target/action/actor/request/필드집합/부재null/동일원문재암호화차이기록; activity context 없으면 감사0 |
| P3 | findOperationUpdatedAt | empty/없는ID/중복ID/삭제표시/동일시각/다른시각 | Map/Date정확값; source조회나새deleted필터추가없음 |
| P4 | backfill rules/orchestrator | 과거/오늘/미래, 실제교육일없음/연속구간/일부mapping/없는파트/미해결참석자 | 원본과같은계획·본문·수신자·순서. 날짜기준의예정을status필터로바꾸지않음 |
| P5 | limit/ACL/dryRun | 이벤트99건뒤여러event회차, reader/freeBusyReader/owner/writer/null/조회오류, dryRun | 회차중간중단없음; 100초과허용가능한원본상한; dryRun도ACL GET은가능하나insert/mapping0 |
| P6 | originalPGlock | 같은회차경합/다른회차/재진입/다른회차중첩/disabled/throw | 원본callback수명/trylock즉시거부/별도PG pool/defaultguard유지 |
| P7 | PGsession손실 | 소유테스트session만pg_terminate_backend; 별도Prisma경로살림; Google응답후barrier | 이전업무/mapping효과잔존가능성을실제로관찰. callback최종실패를무쓰기와동일시하지않음 |
| P8 | PG장기eventloop정지 | worker프로세스정지·다른client획득시도·재개; 연결생존과연결종료를분리 | 연결생존시lock유지, 연결종료시해제가능. 실제정지와clockmock을별도표기 |

정규화는생성UUID를참조검증후대응시키고timestamp를호출구간/단조성검증후치환하는것에한정한다. 이벤트ID·creation key·eventDate·sendUpdates·오류code·mapping참조·배열순서·null·감사필드차이를지우지않는다. 실패무쓰기스냅샷은암호문/ID/시각포함raw그대로비교한다. coord nonce와요청감사는업무snapshot과분리하되그변화도별도검증한다.

## 5. native lease·시간·경합 필수표

추천상수는plan §5의60초lease/15초renewal/5초coordIO/180초전체/10초DB다. 논리시간주입은대기시간을줄이는단위검증용이며서버시간·native경합검증을대체하지않는다. 짧은TTL을사용한별도nativefixture는파라미터가다름을명시하고기본상수배선검증을따로한다.

| ID | 제어·증거 | 기대결과 |
| --- | --- | --- |
| L1 | 서로다른client가같은namespace/id동시최초획득; insert/update native결과 | owner1개/callback1, 정확한최초_id충돌만재조회; activebusy callback0 |
| L2 | 같은runtime재진입·다른operation중첩·다른namespace중첩 | 재진입acquire/release증가0/deadline그대로; 다른범위중첩거부; 독립top-level범위는동시허용 |
| L3-healthy | 실제서버 $$NOW/기본60초 lease, callback을 65초 이상·180초 미만 유지, 무장애 갱신2회 이상 | 반드시 callback성공/LOST0, owner/gen유지·lease연장·callback1. clock주입 테스트는 L3-clock으로 별도 |
| L4 | response지연/늦은renewACK/중복timer·종료 | 요청시작monotonic기준기한보수적; 종료/LOST뒤늦은ACK로재활성0; 갱신동시최대1 |
| L5 | A만료→B획득→A renew/release | A조건부쓰기0, Bowner/gen보존; 세대Long증가/overflow거부; TTL/문서삭제없음 |
| L6a/L6b | §14의 실제 nonce쓰기 성공ACK 뒤commit보류 / Btakeover commit뒤A쓰기 barrier | 실제명령/commit순서·최종값 판정. 대기/조건실패/충돌을 구분하며 반드시112를 요구하지 않음 |
| L7 | 갱신IO실패/owner불일치/응답불명·deadline | signalabort, 새외부전송관찰점거부, callback재획득/재실행0; 기존Google결과취소주장없음 |
| L8 | 프로세스정지→lease만료→B획득→A재개 | 실제nativehandoff와stale mapping거부. 기존PG정지시나리오와의차이를원문기록 |
| L9 | acquire실행후ACK만유실 주입 | callback0. coord소유권잔존가능, owner조건정리/만료회복; 임의callbackretry0 |
| L10 | release오류/ACK불명/새owner획득후stale release | 성공callback결과유지, rawdriver비노출, 새owner보존, expiry후회복가능 |
| L11a/L11b | §14의 DB callback 재실행 / 이미commit된 동일transaction의 ACK 재확인 | a는 guard 재검사; b는 기존A mapping+audit유지, 새guard0. 둘다Googlecallback재실행0 |
| L12-healthy | 같은handle renewal과mapping 스케줄 겹침 | per-handle critical section으로 정상 완료, LOST0, callback1. 외부 takeover를 섞은 고장 시나리오는 L6로 분리 |

callback deadline은관찰점중단이지Promise強制終了가아니다. 이미전송한Google와이미commit된DB가deadline뒤남는fixture를포함한다. 개별60/180초기한을전체POSTwallclock상한이라고검증하지않는다.

## 6. native persistence·원본 한계·복구

| ID | fixture | 필수판정 |
| --- | --- | --- |
| M1 | open미준비/validator불일치/index누락·unique강화/TTL/capped/키형식오류 | open과runtime자동수리0, 업무0; prepare도기존잘못된metadata/reset금지. 유효형식의오답키는K2/K4로분리 |
| M2 | mapping insert/update/delete후감사validator故障 | mapping+감사동일transactionrollback, coordguard도abort, 이전commit문서보존 |
| M3 | 암호문 integrity/복호화 오류 | 실제read에서safeMongo오류, HTTP실패문구/logs에sentinel·cause0. 오답HMAC의miss는오류로단정하지않고K4에서검증 |
| M4 | Google생성성공→mapping실패→새요청 | 첫시도Google존재/mapping없음. 새요청같은deterministicID/409표식확인후mapping+감사1; callback자동재실행0 |
| M5 | insert응답유실·409다른표식·cancelled세대·occupiedID | 기존idempotentCreate규칙 exact. fence/owner를creationkey에섞지않음 |
| M6 | mappingcommitACK최종불명 | mapping+감사全有또는全無, 반쪽상태금지; Google를추가호출해commit확인하지않음 |
| M7 | 여러event중둘째실패 | 첫event효과/감사유지; 원본집계증가위치와failedOperations exact |
| M8 | mapping은있고Google삭제 | reverse/backfillskip·mapping유지; 일반저장missingpatch에서previousEventId로복구·기본메일 |
| M9 | mapping없음·createdAt도입전/경계/이후/모름 | 원본2026-08-21경계보존. cleanup후일반수정도이규칙그대로 |
| M10 | reverse mapping이동후operation失敗 | 유효lease면조건부복원; 잃었으면복원거부가능·partial상태명시. 전체운영rollback을가정하지않음 |
| M11 | lease손실중별도operation writer commit | 허용되는원본한계로실제상태기록. mappingfencing테스트를운영전체fencing증거로쓰지않음 |

## 7. actual API / 효과 호출 검증

새handler suite는실제promotePOST·workspace guard·withActivity·Mongo promotion/operations/teamMembers/teamUsers/calendarPersistence/lease/requestAudit를사용한다. **backfill함수와CalendarEventLink저장소를mock하지않는다.** 실제calendarWriteClient의네트워크transport만합성한다.

양성 fixture는 실제 educationDates를 가진 삭제 운영과 같은 지문의 미연결 source로 만든다. actual promotion이 revived1로 복원하고 보존된 educationDates를 실제 backfill이 읽어 mapping을 생성해야 한다. 현재 승격 core는 educationDays만 옮기고 educationDates는 쓰지 않으므로, 신규 승격+mappedFields 날짜 배열을 양성 fixture라고 가정하지 않는다. 신규 승격은 교육일 없음으로 제외되는 음성 사례로 고정한다. 별도 활성·미매핑·교육일 보유 운영을 함께 두어 기존 전체 backfill 범위도 확인한다. OM의 TeamUser는 파트 추출 가능한 소속으로 만들고 기존 promotion roster의 teamMembers와 Calendar teamUsers 계약을 각각 충족한다.

| ID | 요청·실패 지점 | 응답/저장/효과 판정 |
| --- | --- | --- |
| H1 | non-admin workspace성공,미인증/outsider거부 | 실제권한차이유지;성공은승격refs+실mapping+감사+실요청감사;거부업무/외부0 |
| H2a~H2c | 각포트누락 + namespace/client/backend/runtime혼합 + 중첩scope | 등록된complete runtime은runWithDataRepositories 진입 전 직접거부, 요청감사 포함0effects; 기존unregistered scope의기존실패계약은별도 유지(§14) |
| H3 | §12 고정 R/A/N fixture actualPOST | revived1+created1/sourceRows2, R2+A1+N0=3 events/failed0, 재요청insert0; 전체값·role·파트·actor·token 초기조건고정 |
| H4 | promotion空요약/linked-only/blocked-only/再요청 | 매성공요청backfill1회. 대상全体조회원본유지;이미매핑된eventinsert0,다른미매핑운영이있으면생성가능 |
| H5 | promotion native callback경합/ACKretry | backfill진입0 during retry, 확정반환후1; 앞선handler의native Company경합증거재사용하되합성effect한계를표시 |
| H6 | 개별회차lockbusy/Google실패/mapping실패 | 승격commit유지,200+calendar.failedOperations집계. backfill非throw와throw를혼동하지않음 |
| H7 | backfill초기read失敗throw | 승격commit유지,200/calendar생략/고정로그/revalidation4 |
| H8 | revalidation nth失敗 / requestAudit失敗 | 각각원본400+commit유지 / handler응답유지. 추가Google0 |
| H9 | 完全disabled, scope없는legacyPG/local | enabled:false契約,外部0/lease0;기본PG선택·기존local예외및guard유지. env로Mongo자동선택없음 |
| H10a/H10b | 서로다른namespace/같은Google calendar 대 서로다른calendar | fakeGoogle registry공유. a는같은객체/409/두DB의mapping, b는원격객체분리. namespace를eventID에추가하면실패 |
| H11 | Notionexact와민감suffix·adapter오류 | 기존promotionallowlist정확성유지,신규Mongoerror안전문구;기존승인blockedReasons표시는별도 |

## 8. 인접 호출 계약 / Task map 검증

이번의공유facade영향을확인하는최소compatibility는필수다. 모든실운영호출의Mongo전환완료를주장하지않는다.

H2의 누락 포트 선검사 보장은 promote/backfill의 primary 경로에 한정한다. 인접 경로는 완전한 runtime scope로 검증한다. 기존 reverse의 병렬 외부 조회와 forward의 저장후 반영 때문에, 불완전 scope를 각 entrypoint에서 사전 차단하는 작업은 해당 경로의 후속 배포 연결 조건으로 남긴다. fallback0과 효과시작전 포트검사 완료는 서로 다른 판정이다.

| ID | actual경계 | 이번필수 / 다음Task |
| --- | --- | --- |
| X1 | CalendarReflectingOperationRepository+forward | 명시Mongowrapper로create/update/delete·非관련수정·creationReplayed·missing복구·메일옵션. 전체app의자동wrapper배선은후속 |
| X2 | sync/calendar-events GET/POST | 실제bearer/admin/withActivity,plan→updatedAt→apply 최소1회,표식·ETag·suppression·보상. 예약실행자원/주기확인은후속 |
| X3 | backfill-events GET/POST/DELETE | dryRun/notify/from/limit,cleanuptoken전체선검증·expiry·표식·etag·mapping교체·Google삭제후DB실패再요청. 업무삭제정책변경없음 |
| X4 | refresh-events GET/POST | dryRun/실patch·무메일·revision변경거부·missing不再生成. 제목/설명개편은후속 |
| X5 | calendarWriteClient/OAuth/Slack | 실제callCalendar GET만retry,POST/PATCH/DELETE無一般retry,신호전파,가짜token cache,skip DM생성시에만; 실제credentials/메일전송증거없음 |
| X6 | 전체앱·CLI·관리writer | inventory에미전환경로남김. rawPG3경계검색으로scoped 경로의누수확인; health/backup/実원천/production전환은별도 |

## 9. 변별력 검토용 실패 변형

실제소스를지금변경하거나mutation test를실행하지않는다. 구현후독립검토자는아래변형이각대응검증에걸리는지판정한다.

- Calendar효과를transaction callback안으로옮김 → H5/실제효과counter가실패해야한다.
- leaseUntil을client Date.now로판정하거나만료owner갱신허용 → L3/L5/L8실패.
- scopeidentity에서namespace제거 → L2/H10실패.
- mapping前검사만하고동일transactionguard제거 → L6의후행stale변경차단실패.
- nonce갱신을no-op로변경 → L6a의실제modifiedCount/읽은nonce 변화 증거가 실패해야 한다. 특정112만으로검증하지않는다.
- acquire/renew오류후callback재실행 → L7/L9/외부effect counter실패.
- 신규generation을eventID seed에추가 → M4/M5실패.
- mapping/ActivityChange를별도transaction으로분리 → M2/M6실패.
- move/deleteMatching의eventId/calendarId조건제거 → P1/X3실패.
- Calendar실패를무조건throw하거나failedOperations를HTTP400으로변경 → H6/H7실패.
- 全100건하드컷/operationStatus추가필터/실교육일없이생성 → P4/P5실패.
- suppress-mail기본값反転/원복attendees追加 → X1/X2/X4실패.
- getPrismaClient/assertDefaultDatabaseAccess 자체를mock으로우회 → H2검증무효로거부,adapter/pool아래tripwire로교정.

## 10. 부모 실행·최종 증거 산출 순서

1. G0의 acceptedPromotionSHA/integratedSHA/remoteRef와관측SHA/정리·문서증거를먼저기록하고 다음branch의baseline/폐쇄원본manifest를확정한다. 변경전기존Calendar테스트와원본PGfixture가독립실행가능한지확인한다.
2. 타입검사를먼저하고단위/legacyPG대조→nativelease→mapping/감사→actualhandler순서로실행한다. 아직없는test파일명/패키지script를실행완료라고기록하지않는다.
3. 필요한전체test/type/build/lint와기존promotion handler회귀를부모가실행한다. 기존71skip/lint7과신규차이를분리하고원인없이숫자만동등으로판정하지않는다.
4. ID별원본함수/fixture/test명/endpoint/로그/실제오류code/요청수/DBsnapshot/digest/skip여부표를작성한다. raw/native/driver注入/clock注入/合成외부를구분한다.
5. 독립critic과meta가원본보장과추가보장을구별했는지,미해결差異를정규화로숨기지않았는지검토한다. 소유합성DB정리와제품기본PG유지를확인한다.

열린사항: 새업무승인질문은없음. plan-v2 §11~17의기술미검증은초안검토/실행으로확정한다. 원본에없는exactlyonce·전체fencing·무기한보류를수락조건으로추가하지않는다. lease알고리즘에실제반례가나오면계획개정/필요시Task분리하며테스트기준을무음완화하지않는다.


## 11. R1/R3 — gate·frozen closure·독립 remote fake

| ID | 구현 전 산출물/검증 | 실패 조건 |
| --- | --- | --- |
| G0 | plan-v2 §13의 수락/정리/문서/accepted·integrated·remote SHA 표. final promotion과새branch ancestry 대조 | 현재 조사HEAD를최종통합SHA로간주, remote 미확인을완료로간주 |
| O1 | 원본 entry roots→정적import/re-export/리터럴dynamicimport/alias를 따라 dependency graph 작성 | frozen root가 바뀐 product 하위모듈을 import |
| O2 | manifest 행: originPath, frozenPath 또는 sharedPath, SHA256, parent imports, 분류 F/S/E, resolver target | manifest 누락·digest불일치·미등록runtime import는실행거부 |
| O3 | 원본 기대값/remotefake가신규builder/port/codec helper결과에의존하지않음 | 새buildCalendarEventBodies/새runtime mapper로expected를계산, fake가Mongo저장값을읽어remote상태를맞춤 |
| O4 | 별도프로세스 PG원본/newPG/Mongo 실행; 독립fixture snapshot과동일합성외부초기상태 | module cache/mock registry/token cache/clock이서로오염 |

F는 변경 예정 root와 거기서 도달 가능한 **변경 의존 모듈까지 동결**한다. 예: backfill→calendarEventLinkRepository/calendarOperationLock/calendarWriteClient, participants→teamUser facade, actual route→importPromotionEffects/dataRepositoryContext, 로그경로→notifySlack. root만 dataURL로 만들고 새 facade를 불러오는 oracle은 불합격이다.

S는 실제 변경되지 않은 모듈만 공유할 수 있으며 test 시작 시 manifest digest를 확인한다. 이후 수정되면 S→F 전환하거나 frozen 전체 source tree로 resolver를 바꾼다. E는 명시된 외부경계뿐이다: PG 테스트 연결/합성 auth provider/Next revalidation/clock 및 Google·OAuth·Slack transport. requireWorkspaceSession/withActivity/업무판정까지 E로 만들어 실제검증이라고 부르지 않는다. type-only import와 runtime import를 구분하고 불명 dynamic import는 명시 resolver 항목으로 추가한다.

원본 freeze는 G0 통합 기준의 전체 source snapshot을 사용하는 방법도 허용한다. 이 경우에도 package/lockfile/ts-loader/runtime버전과 resolver allowlist를 manifest에 적고 원본 namespace가 새 working tree로 새지 않게 한다. v1의12digest는 참조 출발점이며 의존폐쇄 완료 증거가 아니다.

독립 fake 설계:
- state는 `Map<calendarId, Map<eventId, {body,status,etag,updated}>>`, 별도의 mutation ledger / notification-request ledger / OAuth token ledger다. Mongo mapping·새 port·새 event builder를 읽지 않는다.
- POST는 요청 id를 그대로 remote key로 저장하고 같은 id가 이미 있으면409. 409 GET은 저장된 객체/표식을 반환한다. PATCH/DELETE는 If-Match·404/410·cancelled·etag 갱신을 fake 자체규칙으로 처리한다. 임의성공response만 반환하는 spy로대체하지않는다.
- Google가 적용한 뒤 응답이 끊긴 fault는 remote registry를 바꾼 **후** reject한다. 적용전 오류는 바꾸지않는다. abort가remote mutation을자동취소/삭제하지않는다.
- event ID expected는 contract literal과독립crypto계산 또는 G0 frozen writeClient에서얻는다. 신규 ID helper를 expected에공유하지않는다. 일정구간·sendUpdates·수신자·집계는§12의literal을사용한다.
- PG원본과Mongo비교는각각동일초기snapshot의별도fake를쓴다. **H10만 두scope가하나의fake를공유**한다. 각scope별remote fake를나눠가짜외부격리를만들지않는다.
- notification ledger는sendUpdates 요청의기록이다. 실제Google메일발송/중복방지증거가아니다.

## 12. H3 literal fixture·정답

날짜판정을 위해 고정된 KST today를 `2099-11-30`로 제공한다. 이 calendar clock seam은 Mongo 서버 lease 시간/monotonic 시계를 바꾸지 않는다. 고정 Date.now를 써야 하는 별도 원본 프로세스와 native lease 시간을 한 프로세스에서 혼동하지 않는다.

| 항목 | 고정 초기값 |
| --- | --- |
| actor | email `calendar-actor@day1company.co.kr`, name `Synthetic Calendar Actor`, workspace허용/관리자목록미포함; ADMIN_EMAILS는별도주소 |
| TeamUser OM | name `가상CalendarOM`, role `OM`, team `AX 1파트`, email `calendar-om@example.invalid`, slackId `synthetic-om` |
| TeamUser LD | name `가상CalendarLD`, role `LD`, team `AX 1파트`, email `calendar-ld@example.invalid`, slackId `synthetic-ld` |
| roster/파트 | 저장role는대문자,teamUserDTO는기존adapter의lowercase role. teamMembers에서는미분류팀이어도이름을포함; teamUsers에서는1파트추출. 명단fallback0 |
| R 복원대상 | operationId `synthetic-calendar-r`, 고정UUID 참조, fingerprint=`a`64개, deletedAt설정; educationDates=`[2099-12-01,2099-12-02,2099-12-04]`, 시작12-01/끝12-04 |
| A 별도활성 | operationId `synthetic-calendar-a`, 별도고정UUID/과정참조, source run밖, deletedAt=null; educationDates=`[2099-12-05]`, 시작/끝12-05 |
| N 신규대상 | fingerprint=`b`64개, R과다른업무키, 시작/끝12-06; 신규default educationDates=[] |
| run/source | COMPLETED csv/TEAM_1, source R,N 두행(같은sheet의2,3행), validationErrors=[], 처음둘다미연결. sourceR이R을복원하고sourceN이N을생성 |
| 표시값 | company/course 각각 `Synthetic Calendar Company R/A/N`, `Synthetic Calendar Course R/A/N`, courseId `1001/1002/1003`, roundNo=`1`; om/ld=위명단, onsiteOm/instructors/timeText/region 비움; educationDays=R3/A1/N1. 운영상태배정필요 |
| credential/config | `GOOGLE_CAL_PART_CALENDARS=1파트:synthetic-calendar-1@example.invalid`; OAuth세값모두합성. HUB_OM_BASE_URL 미설정, SLACK_CALENDAR_ALERT_EMAIL 미설정 |
| token/remote | token cache cold, OAuth한번이synthetic-token과충분한expires_in반환; ACL owner; remote registry와mapping비어있음; 외부오류/renewal손실주입없음 |
| DB metadata | 모든모델/coord/index 준비완료,같은client/db/namespace builder,별도암호화/HMAC키(둘은달라야함),공유counter highwater명시 |

R,A,N의 company/course 값은 대응 source/기존operation에 일치시킨다. R의 기존 course/id와 educationDates는복원후보존돼야한다. 실제promotion이R을복원하지못하면fixture를후처리수정해서성공시키지않는다.

첫 POST의 literal 정답:
- result=`{sourceRows:2,eligible:2,blocked:0,blockedReasons:{},created:1,linkedExisting:0,revived:1}`.
- 원격 이벤트는 R의12-01~12-02구간1개 + R의12-04한개 + A의12-05한개 = **3개**. N은0개.
- all-day start/end(exclusive)는 각각 `(12-01,12-03)`, `(12-04,12-05)`, `(12-05,12-06)`; mapping eventDate는12-01/12-04/12-05. attendees는OM email한명, LD초대0. sendUpdates=none, guestsCanModify=true, guestsCanInviteOthers=false.
- 1파트제목은 `[강의관리] Synthetic Calendar Company R_Synthetic Calendar Course R_1회차` 두건과 A대응제목한건. 설명본문/표식은동결oracle와대조하되새builder로expected를만들지않는다.
- HTTP200/ok=true/calendar=`{insertedEvents:3,failedOperations:0}`. backfill 직접관찰totals=`{operationsScanned:3,inScope:3,alreadyComplete:0,excludedNoEducationDates:1,plannedOperations:2,plannedEvents:3,insertedEvents:3,skippedOperations:0,failedOperations:0,capped:false}`. options exact{dryRun:false},limit100,notifyAttendees=false,from=2099-11-30.
- cold token OAuth POST1, ACL GET1, event POST3, conflictGET0, Slack0. remote3/mapping3, CalendarEventLink create감사3. actor는합성인증사용자와같고requestId는응답X-Request-Id와같으며요청감사200 한건. promotion업무감사는별도원본집합비교, source mutation감사0.

같은run 두번째POST: empty promotion summary, backfill 호출1추가, calendar0/0, event POST0/새mapping감사0,remote3유지. directly observed totals는operationsScanned3/inScope3/alreadyComplete2/excludedNoEducationDates1/plannedOperations0/plannedEvents0/insertedEvents0/skippedOperations0/failedOperations0/cappedfalse다. token은warm이므로추가OAuth0,ACL GET1은계속가능. 새요청감사1,기존업무문서/감사exact unchanged(lease coordination과요청감사는따로검증).

## 13. R4 — 단계별 고정 실패표

F표는 **R-only fixture**(§12의R만,sourceRows1/eligible1/revived1,두계획event)로독립실행한다. token cold/ACL owner/remote-empty가매행초기조건이다. 업무promotion은F0/F1을제외하고먼저commit한다. mapping감사는mapping과같은건수다. fake remote수는active event객체수이며요청시도수와다르다.

표의cal은promote응답의calendar필드, I/F는backfill insertedEvents/failedOperations다. 각행은지정한단계에서만오류를낸다.

| ID / 정확한 지점 | HTTP / cal / I,F | remote / mapping / event POST 시도 | 기타 |
| --- | --- | --- | --- |
| F0 registered runtime혼합/누락,scope진입前 | 직접거부; HTTP응답없음 | 0/0/0 | requestActivity도0,lease0,OAuth/ACL0,PG0 |
| F1 실제workspace guard거부 | 기존NEXT_REDIRECT 307 경로 | 0/0/0 | 실제withActivity가307감사,업무0; guardmock없음 |
| F2 promotionACK후 초기 operations또는links전체조회 throw | 200/cal생략, backfill전체throw | 0/0/0 | OAuth/ACL0,revalidation4,고정Calendar실패로그 |
| F3 ACL GET403(재시도대상아님)만실패 | 200/cal2,0; I2/F0 | 2/2/2 | ACL1·OAuth1,accessRole불명은시도;accessError안전고정 |
| F4 ACL reader | 200/cal0,0; I0/F0 | 0/0/0 | item skipped1,OAuth1/ACL1;실패로세지않음 |
| F5 item lock busy | 200/cal0,1; I0/F1 | 0/0/0 | callback0. lease前ACL1/OAuth1은허용 |
| F6 첫event POST503,적용前오류 | 200/cal0,1; I0/F1 | 0/0/1 | 쓰기자동retry0,두번째event시작0 |
| F7 첫event remote저장後응답유실 | 200/cal0,1; I0/F1 | 1/0/1 | fake는abort/reject때remote를지우지않음 |
| F8 첫event성공後mapping확정rollback | 200/cal0,1; I0/F1 | 1/0/1 | mapping감사0,driver본문노출0 |
| F9 첫event+mapping성공,둘째POST적용前실패 | 200/cal1,1; I1/F1 | 1/1/2 | 앞선mapping/감사유지 |
| F10 두event+mapping완료後최외곽완료검사에서LOST | 200/cal2,1; I2/F1 | 2/2/2 | 결과failed여도과거commit유지 |
| F11 두event정상완료verdict後release실패만 | 200/cal2,0; I2/F0 | 2/2/2 | 성공결과유지,lease잔존가능·expiry회복,안전로그 |
| F12 정상Calendar후revalidation n번째失敗 | 400/generic error,cal필드없음 | 2/2/2 | 업무commit유지,앞n회revalidate,requestActivity400 |
| F13 requestActivity저장失敗만 | 200/cal2,0 | 2/2/2 | 요청감사0,고정감사로그,추가효과0 |
| F14 첫mapping실제commit後ACK최종불명 | 200/cal0,1; I0/F1 | 1/1/1 | 주입fixture는servercommit확정. 미관찰현실의all-or-none와구분 |
| F15 L11b 예산 내 강제 owner 변경·ACK재확정 fault | 200/cal1,1; I1/F1 | 1/1/1 | 실제commit을유지, fault임을명시. 자연만료로DB10초예산이끝나최종불명이면F최종불명처럼I0/F1이며mapping은남을수있음 |

F7/F8다음새요청은첫event같은ID POST409→표식GET으로mapping복구하고둘째event신규생성한다. 새요청의 I2/F0,remote최종2,mapping최종2,POST시도2(409포함)다. insertedEvents는원격신규생성수와동일하다고가정하지않는다. F14새요청은이미mapping있는첫event를skip하고둘째만생성(I1/F0)한다.

ACL前조회는lease밖이므로F5에서OAuth/ACL0을요구하지않는다. F2의초기Promise.all조회실패에서는ACL loop가아직시작되지않으므로0이맞다. 개별item의mapping scan超過는F5와같은item failed위치이며전체throw로바꾸지않는다.

## 14. Critic P1 — 경합·재시도·scope·fetch barrier

### L6a / L6b — 정확한 native barrier

L6a: A획득→mapping native transaction의 조건부nonce쓰기 실제성공ACK/변화 확인→mapping/감사쓰기→commit서버전송前보류. 제품은 진입여유16초/DB10초이므로 정상 예산 내 자연만료 takeover를 필수화하지 않는다. 실제 서버 충돌 검사는 별도 client B가 같은 owner 문서에 강제 takeover 조건으로 쓰도록 하는 **명시 결함 주입**으로 하고 native DB 경합/대기 순서를 관찰한다. Acommit을풀고B결과·최종mapping/감사를확인한다. 실제 자연만료는 L8의 process pause로 분리하고 deadline 종료를 성공으로 완화하지 않는다. 특정112를강제하지않으며조건실패/예산실패/직렬성공을그일정과대조한다.

L6b: A획득→어떤mapping transaction도쓰기시작하지않은상태에서A정지→실제server lease만료→B조건부takeover 성공ACK 및majority조회로owner/gen확인→A의옛handle로mapping DBcallback시작. guard불일치/기한거부,nonce·mapping·감사변화0,Google추가0. Bcommit前에A를풀지않는다. 동작을모사한112를던져native경합이라고부르지않는다.

### L11a / L11b — callback과commit을분리

L11a는DBcallback再실행fixture다. 첫mapping transaction이commit하지않은채abort된증거를확보하고,실제native경합또는명시라벨driver fault로callback再시도를유도한다. 재시도前Btakeover를완료시키면Aguard재검사거부,새mapping/감사0이다. native와주입증거를별도표시한다. Google생성callback은첫번1회만이며재시도로추가0이다.

L11b: 첫commit을실서버에delegate한뒤ACK만감춘다. DB10초예산내 B의강제owner/generation변경과UnknownTransactionCommitResult를주입하고 같은session/txn commit재확인을관찰한다. **자연만료/native handoff가아닌결함주입**이다. 재확인時새callback/guard0,기존A mapping+audit1/Bowner유지/remote1이다. 저장함수가예산내반환한경우F15의I1/F1; 실제process정지후자연만료로10초예산종료면최종불명I0/F1/commit잔존으로검증한다. 이둘을하나의성공정답으로강제하거나제품예산을늘리지않는다.

이시험은서버commit후ACK주입이며네트워크절단이나프로세스crash증거가아니다. driver convenient API가callback을실제로재실행했는지/commit만반복했는지각카운터와session/txn식별로구별한다.

### H2 / H10 — 내부격리와원격객체격리

H2a: registered complete scope의각필수port제거. H2b: 하나씩다른namespace/client/database/runtime의실제port및legacyPGport로교체. 실제runWithDataRepositories의registry검사로work미진입,requestActivity0/business0/lease0/Google0/OAuth0/Slack0/PG0이어야한다. 기대object identity와옵션provenance를바꿔치기하지않는다. H2c: valid scopeA의held lease안에서complete scopeB를중첩하면 B callback진입counter0/lock이전업무sentinel0을검증한다. scope진입자체를거부해뒤늦은lock검사전에도업무0이어야한다. unregistered기존scope의withActivity누락동작은기존handler회귀로별도확인한다.

H10a: 별도DBnamespace A/B에같은operationId/교육일/동일body,같은calendarId를seed하고**공유fake registry**에서actualPOST를겹친다. 각scope의DB lease/mapping/감사/request는격리되지만동일eventID의remote객체는1개다. 두POST중하나는201,다른하나는409→표식GET으로같은ID를연결한다. 두scope각mapping1,remote1,sendUpdates=none이고namespace/fence를ID seed에넣으면실패다. 409를실패로간주하거나remote2를기대하지않는다.

H10b: 같거나겹친operationId/date여도calendarId를A/B다르게주고공유fake로검증한다. remote2,DB각mapping1. 독립top-levelscope이므로ALS재진입과다르다. 둘의actor/requestID도각각명시분리한다. 서로다른scope의event내용이같지않을경우remote내용까지독립이라고보장하지않으며그경우는새격리기능으로확장하지않는다.

### E1~E4 — await 이후의fetch 확인

| ID | 정확한 barrier | 기대 |
| --- | --- | --- |
| E1 | nativelease안coldtoken OAuth fetch전검사통과→OAuth응답보류→leaseLOST→OAuth응답반환 | OAuth시도1,그뒤Calendar fetch0. getAccessToken前검사만있으면실패 |
| E2 | valid cachedtoken hit→token Promise해결과Calendar fetch사이에LOST | OAuth0,Calendar fetch0. cache경로도await後검사 |
| E3 | GET첫응답429/5xx→800msretry대기중LOST | 최초GET1,대기후두번째GET0. 원격쓰기0 |
| E4 | backfill초기ACL조회,아직lease없음 | 정상OAuth/ACL허용;일반requestSignal timeout유지. 모든Calendar fetch에lease필수라고해서초기ACL을막으면실패 |

E1~E3의loss는실제소유권교체또는명시signal fault로표시하며단순mock만으로lease protocol검증을대체하지않는다. 전송후remote성공잔존은F7등에서별도검증한다.

## 15. R5/R6/P2 — 정상 갱신·Map·scan·키

L3-healthy는기본60/15/180초배선으로실제서버갱신2회이상,최초lease를넘는callback정상성공을요구한다. 실행시간상단축한parameterized nativecase는보조증거로표시한다. L12-healthy는renewal예정시점과mapping10초이내구간을겹쳐도내부직렬화로성공하고LOST0이어야한다. timer누락·자기lock timeout을'안전하게실패했음'으로통과시키지않는다.

L3-clock은clientwallclock앞/뒤변경·늦은timer/ACK를주입하는단위시험이며native서버시간검증과분리한다. L8-native는소유worker의실제정지/재개와다른client takeover를관찰한다. 원본PGworker의연결생존/연결종료case를나란히보여주며PG도상실후외부효과가남을수있음을확인한다.

P2b는동일calendarId/eventId를가진서로다른operation/date의두link를seed한다. Map크기는그key당1이고선택값은두후보중하나이며모든필드/후속처리는그후보와일치해야한다. backend간선택UUID/무정렬row순서를강제하지않는다. unknown후보·임의합성row·추가unique정책은실패다.

M12는실제scan경로별20,000행허용/20,001행거부,32MiB경계/초과,15초예산초과를구분한다. BSON크기는실제암호화document bytes로측정한다. 행/byte초과는native데이터로,기한검사는clock주입과실제IO지연을별도표시한다. 초기backfill scan失敗는F2,잠금안currentLinks scan失敗는item failed이다. 앞부분만Map/목록으로반환하거나초과후Google쓰기를계속하면실패다.

| ID | 키/데이터 조건 | open/read 기대 |
| --- | --- | --- |
| K1 | JSON/Base64길이/active key ID형식오류,암호화키=HMAC키 | open配置검사실패,DB/외부쓰기0,안전오류 |
| K2 | 형식은유효하지만저장시와다른암호화키(같은keyID),올바른HMAC키 | metadata open은통과할수있음. 실제암호화row read에서GCM복호화실패. open이내용까지검증한다고거짓주장하지않음 |
| K3 | 올바른키,저장envelope/tag/context손상 | 실제read에서안전복호화실패,raw message/cause노출0 |
| K4 | 올바른암호화키,형식유효한오답HMAC키 | open형식검사통과,private equality는정상빈결과가능. listAll/공개키read로해당행을읽으면GCM복호화후codec의INDEX_MISMATCH로실패한다. HMACmiss를必然decrypt오류나키오류로단정하지않음;평문조회fallback0 |

K4는현재형식검사로잘못된유효HMAC키를탐지할수없다는한계증거다. 이번에전체key-verifier schema/키회전정책을추가하지않는다. 올바른배포키구성은후속production연결gate이며오답키fixture를정상업무데이터없음과구분해보고한다.

## 16. 부모 PII 보완 — 승인 출력과 비노출 검증

S1 정상응답: 권한있는관리API의unresolvedNames/attendeeEmails/calendarId/eventId/업무표시값과기존promotionblockedReasons는원본계약대로허용한다. 승인된정상DTO가있다는이유로console/ActivityChange/rawDB에원문을복사하지않는다.

S2 저장: calendar/event ID·개인명·actor이메일등**기존암호화대상필드**에독립sentinel을넣고raw문서와감사의평문0을확인한다. 공개업무필드인회사/과정명에PIIsentinel을넣어새암호화정책을몰래요구하지않는다. codec/hmac/변경감사의redaction을각각검사한다.

S3 로그: actualforward에서미해결사람이름,missing복원eventId,reversecancelled의calendar/event ID,backfill/refresh/apply의원문error,OAuth응답body/token,driver원문을각각주입한다. console 모든level을수집해sentinel/name/email/calendarId/eventId/token/body/stack0,고정code/count/requestId만남는지검증한다. 원본oracle로그는별도캡처해의도된노출축소차이를기록한다.

S4 Slack: 실제notifyCalendarReflectSkip와하위sendSlackDirectMessage→botPost/openDirectMessageChannel를통과시키되Slack fetch만합성한다. 미해결수신자email과下位catch의rawError가로그로새지않는지확인한다. 허용된조건의실제DM본문/수신자선택은합성ledger에서검증하고create때만통지하는원래규칙을보존한다. 송신전체를mock해서하위catch를건너뛰면노출검증증거가아니다.

S5 실패응답: knownsafe code/고정메시지,그문구+민감suffix,미등록한국어,Googleresponse.text원문을actualAPI catch/outcome.detail/accessError까지주입한다. 임의message를노출하지않고generic으로치환해야한다. HTTP/status/집계/메일/이미commit한상태는F표대로유지한다. startsWith/한국어판별변형은반드시실패해야한다. 레거시PG도touchedflow로그/실패표현안전화를적용하되기본backend·disabled와권한은변경하지않는다.

변경파일추천은plan §10/16에명시했다. 모든앱로그/외부원천분석으로확장하지않고이번Calendar호출에서실제로도달하는표면만보완한다.

## 17. 최종 trace·미해결 판정

R1→G0/O1, R2→L2/L4/L7/L10/H2, R3→O1~O4/H3 independentfake, R4→F0~F15, R5→L3-healthy/L12-healthy/L3-clock/L8-native, R6→X1~X6/P2b/M12/K1~K4. Critic P1은L6a/b·L11a/b·H10a/b·E1~E4·H3, P2는P2b/K1~K4, 부모추가는S1~S5다.

각callsite의현재조립/이번검증/후속활성화gate는plan §17의표를최종인계에도남긴다. 인접흐름compatibility완료와production의명시scope조립완료를동일시하지않는다. registry의등록complete runtime을사용하면해당scope누락/혼합은entry前에거부되지만,unregistered별도scope의direct reverse/forward까지완료했다고주장하지않는다.

결과를크게바꾸는새업무미결정은현재없다. promotion문서/remote/integration SHA gate는완료됐고최종독립계획수락후구현한다. 수치·상태machine·오류표현은이v2추천으로검토하며,실행반례가발견되면관련ID와계획을수정한다. 원본에없는exactlyonce/전체fencing/무기한보류를재승인요구로추가하지않는다.
