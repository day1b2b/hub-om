# Calendar Validation v1 — 부모 / critic / meta 검토용

대상: plan-v1의단일수직단위. 현재는검증설계만작성했으며새코드·DB·테스트·외부실행없음. 선행promotion의부모전달PASS와Calendar실행증거를분리한다.

## 1. 판정 원칙

1. 원본 PG 보장은 session 살아있는 동안의 잠금과 협력적 abort다. 잠금손실후 Prisma/Google 효과잔존을실패로단정하지않는다. Mongo lease가장기정지에도만료되는차이와mapping fencing강화는명시대조한다.
2. 실제원본함수/PG adapter, 실제nativeMongo, actualPOST/withActivity/guard를독립적으로검증한다. 신규core/adapter를원본oracle에공유하지않는다.
3. 응답과저장상태와외부호출은별개oracle다. HTTP200안의failedOperations, HTTP400인데승격commit유지, mappingcommit불명, release실패를각각판정한다.
4. native경합/connection termination, driver ACK오류주입, clock주입, 합성transport를구분표기한다. mock으로만든112를native경합증거로쓰지않는다.
5. mapping보호만검증하고운영전체fencing/Googleexactlyonce를주장하지않는다. DB retry와외부callback retry를분리해후자는항상0을검증한다.
6. 필수native/PG suite는전용opt-in없으면skip가능하나수락증거가아니다. 부모가전용endpoint를공급한검증에서는필수시나리오0skip이어야한다. 미실행/환경실패를PASS로적지않는다.

## 2. 원본 추적성·동결

현재checkout HEAD: `75125c9644d6c8265fbdae59e5c9d450247170ef`. 일부승격소스는working tree에있으므로아래SHA256이원본식별의일부다. 구현시작직전에부모가아래바이트를별도fixture로복사하고digest를대조한다. 이번draft는원본fixture를추가작성하지않는다.

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

- 미래부모전용env 제안: `MONGODB_CALENDAR_TEST_URI`, `PG_CALENDAR_TEST_DATABASE_URL`. loopback만허용하고credentials/DB이름/replicaSet/port를검증한다. 기존promotion27839를묵시재사용하지않는다. 포트와replicaSet은부모의전용실행자원에명시고정한다.
- 매suite random소유DB/namespace, 임시PII키, 합성TeamUser/Operation/source/mapping/Google event만사용한다. 운영URI/.env/실원천을읽지않는다. finally는소유가확정된자원만정리한다.
- 테스트의실제calendarWriteClient를유지하고fetch transport만OAuth token endpoint·Calendar API 합성응답으로바꾼다. 요청body/URL/query/headers/signal/횟수/순서를기록한다. 허용합성endpoint 외는즉시tripwire실패. 실제DNS/네트워크는하지않는다.
- OAuth는가짜자격증명과가짜token/cache reset으로검증한다. 실제refresh token/access token이필요하지않다. Slack최하위송신만synthetic spy/tripwire로막고생성skip通知의조건은실제코드로확인한다.
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
| L3 | 실제서버 $$NOW획득/갱신; client Date.now를크게앞/뒤로주입 | 소유권판정이clientwallclock에따라뒤집히지않음; owner/generation 유지갱신 |
| L4 | response지연/늦은renewACK/중복timer·종료 | 요청시작monotonic기준기한보수적; 종료/LOST뒤늦은ACK로재활성0; 갱신동시최대1 |
| L5 | A만료→B획득→A renew/release | A조건부쓰기0, Bowner/gen보존; 세대Long증가/overflow거부; TTL/문서삭제없음 |
| L6 | A mapping guard쓰기보류→B takeover; 반대순서도실행 | 실제112/서버경합확인; 전자A선commit허용, 후자stale mapping+audit0; 단순순차성공으로대체금지 |
| L7 | 갱신IO실패/owner불일치/응답불명·deadline | signalabort, 새외부전송관찰점거부, callback재획득/재실행0; 기존Google결과취소주장없음 |
| L8 | 프로세스정지→lease만료→B획득→A재개 | 실제nativehandoff와stale mapping거부. 기존PG정지시나리오와의차이를원문기록 |
| L9 | acquire실행후ACK만유실 주입 | callback0. coord소유권잔존가능, owner조건정리/만료회복; 임의callbackretry0 |
| L10 | release오류/ACK불명/새owner획득후stale release | 성공callback결과유지, rawdriver비노출, 새owner보존, expiry후회복가능 |
| L11 | DB callback transient/commit ACK retry, generation교체 | 재시도매번동일owner/gen재검사; 소유권상실시추가mapping0; Googlecounter증가0 |
| L12 | renewal과mapping txn의경합 | native112가발생해도DB만예산내재검사. 성공또는명시LOST결과, 무한renew/retry없음 |

callback deadline은관찰점중단이지Promise強制終了가아니다. 이미전송한Google와이미commit된DB가deadline뒤남는fixture를포함한다. 개별60/180초기한을전체POSTwallclock상한이라고검증하지않는다.

## 6. native persistence·원본 한계·복구

| ID | fixture | 필수판정 |
| --- | --- | --- |
| M1 | open미준비/validator불일치/index누락·unique강화/TTL/capped/잘못된PII키 | open과runtime자동수리0, 업무0; prepare도기존잘못된metadata/reset금지 |
| M2 | mapping insert/update/delete후감사validator故障 | mapping+감사동일transactionrollback, coordguard도abort, 이전commit문서보존 |
| M3 | mappedcalendar/event암호문파손·HMAC값·조회실패 | safeMongo오류, HTTP/logs에sentinel·drivercause0; plaintextDB필터fallback0 |
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
| H2 | scope각누락(importPromotion/teamMembers/importPromotionCalendar/requestActivity/operations/teamUsers/calendarPersistence/calendarLock) | 선검사위치별기존실패; 승격업무0·OAuth/Calendar/Slack0·Prisma/PgPool0 |
| H3 | 교육일보유삭제운영의실제승격복원→실backfill→실mapping, 별도신규승격음성사례 | 양성revived1/교육일보존/실insert, 음성created1/교육일없음제외; options exact{dryRun:false}, totals exact, OAuth/insert/sendUpdates=none, mapping교육일/CalendarID/eventID/감사actor=requestID검증 |
| H4 | promotion空요약/linked-only/blocked-only/再요청 | 매성공요청backfill1회. 대상全体조회원본유지;이미매핑된eventinsert0,다른미매핑운영이있으면생성가능 |
| H5 | promotion native callback경합/ACKretry | backfill진입0 during retry, 확정반환후1; 앞선handler의native Company경합증거재사용하되합성effect한계를표시 |
| H6 | 개별회차lockbusy/Google실패/mapping실패 | 승격commit유지,200+calendar.failedOperations집계. backfill非throw와throw를혼동하지않음 |
| H7 | backfill초기read失敗throw | 승격commit유지,200/calendar생략/고정로그/revalidation4 |
| H8 | revalidation nth失敗 / requestAudit失敗 | 각각원본400+commit유지 / handler응답유지. 추가Google0 |
| H9 | 完全disabled, scope없는legacyPG/local | enabled:false契約,外部0/lease0;기본PG선택·기존local예외및guard유지. env로Mongo자동선택없음 |
| H10 | 서로다른namespace두actual요청겹침 | actor/requestID/mapping/감사/lease/효과분리,동일operationId라도공유ALShandle오인0 |
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
- nonce갱신을no-op로변경 → nativehandoff경합증거와L6실패.
- acquire/renew오류후callback재실행 → L7/L9/외부effect counter실패.
- 신규generation을eventID seed에추가 → M4/M5실패.
- mapping/ActivityChange를별도transaction으로분리 → M2/M6실패.
- move/deleteMatching의eventId/calendarId조건제거 → P1/X3실패.
- Calendar실패를무조건throw하거나failedOperations를HTTP400으로변경 → H6/H7실패.
- 全100건하드컷/operationStatus추가필터/실교육일없이생성 → P4/P5실패.
- suppress-mail기본값反転/원복attendees追加 → X1/X2/X4실패.
- getPrismaClient/assertDefaultDatabaseAccess 자체를mock으로우회 → H2검증무효로거부,adapter/pool아래tripwire로교정.

## 10. 부모 실행·최종 증거 산출 순서

1. 다음branch의baseline/원본manifest를확정한다. 변경전기존Calendar테스트와원본PGfixture가독립실행가능한지확인한다.
2. 타입검사를먼저하고단위/legacyPG대조→nativelease→mapping/감사→actualhandler순서로실행한다. 아직없는test파일명/패키지script를실행완료라고기록하지않는다.
3. 필요한전체test/type/build/lint와기존promotion handler회귀를부모가실행한다. 기존71skip/lint7과신규차이를분리하고원인없이숫자만동등으로판정하지않는다.
4. ID별원본함수/fixture/test명/endpoint/로그/실제오류code/요청수/DBsnapshot/digest/skip여부표를작성한다. raw/native/driver注入/clock注入/合成외부를구분한다.
5. 독립critic과meta가원본보장과추가보장을구별했는지,미해결差異를정규화로숨기지않았는지검토한다. 소유합성DB정리와제품기본PG유지를확인한다.

열린사항: 새업무승인질문은없음. plan §11의기술미검증은초안검토/실행으로확정한다. 원본에없는exactlyonce·전체fencing·무기한보류를수락조건으로추가하지않는다. lease알고리즘에실제반례가나오면계획개정/필요시Task분리하며테스트기준을무음완화하지않는다.
