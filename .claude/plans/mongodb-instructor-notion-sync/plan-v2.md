# 강사 Notion 동기화 Plan v2

핵심난이도: 원본NO/legacy매칭과수동필드보존을 Mongo 원자적write 및기존manualwriter와양립시키면서dryrun무쓰기/부분실패를보존하는것.

1. [Core] 원본계약확정. 해당 NO의 저장행이있으면해당행, 없으면이름exact+NO null인legacy, 없으면create. 이름/no갱신,notionId는truthy때만,recruitAvoid는현재OR원천,profile/syncedAt대체;수동3필드는보존. 매핑불가skip;행DB실패errors후다음행;source실패는전체실패. dryrun은각행을현재DB에대조하고가상앞행변경을적용하지않음. 산출source-findings/독립originaloracle. 수락: 원본과분기·집계·변경문구일치,오류text정제만의도된차이.
2. [Core] 작은read/mutation계약선택. 기본PG는기존select/update/create를유지. Mongo는기존MongoInstructorNoteRepository의transaction/save/audit 재사용해동기화행전체를snapshot에서재매칭후저장;실제documentwriteconflict/NO unique retry로manualwriter갱신유실을막음. dryrun은reader만,guard나감사쓰기없음. 이름은HMAC후원문검증;잘못된키/문서failclosed. 복수legacy첫행은기존미정순서한계기록. 산출repositoryinterface/PG/Mongo·workflow. 수락: manual3필드/recruitAvoid 보존,NO중복없음,감사실패rowrollback,다른rowcommit유지.
3. [Shell] factory/context에 instructorNotionSync/instructorNotionSource 추가, 두port를source.readPages전에해결. 명시scope누락시PG/source호출0. 기본source만기존Notionfetch를lazy호출,실제접속금지. 기존auth/withActivity/API응답형식유지;원천/행오류고정코드. 산출facade/factory/API실호출. 수락: bearer/admin권한기존동등/누락scope실패/인가된preview값정상.
4. [Check] 독립PG원본oracle로기본PG/Mongo 대조(원본helper그대로고정,UUID/실행시각만정규화),미리보기/초회/재실행/이름변경/legacy/동명다른NO/중복source행/invalidNO/부분실패/조건부ID/stripPII/OR검증. 실제Mongo암호화HMAC변조·수동writer경합·unique경합·감사rollback·dryrun무쓰기;실제GET/POST auth/원천실패/누락context/noPG/fetch0. 산출tests/logs. 수락: 핵심시나리오실행pass,미실행pass금지.
5. [Check] 전체일반테스트·Mongo묶음·PG단위·typecheck/lint/build 실행,독립실행리뷰로기준대조. 초기실패와수정증거보존,새변경없으면중복검사안함. 소유loopbackDB/합성키만,정상종료후소유dbpath정리. 문서/coverage/macro/남은차단목록업데이트,featurecommitpush·총괄통합·원격SHA일치확인. 수락: unresolved리뷰없음,완료근거와운영미완료구별.

대안: 별도Mongo저장class복제는manualsave/audit드리프트비용,기존class에좁은sync메서드재사용선택. 일반saveNoteByNotionNo만재사용하면legacy연결/OR원자성을표현못하므로거절. PG동시성확장은현재범위에서원본의순차쿼리계약을보존하고Mongo강화와한계구별한다.

## Changelog / 최종 보완
- initialize():void를workflow시작/행catch밖에서정확히1회. PG는원본getPrismaClient구성확인만, Mongo는open후no-op. 두port해결→source전체수집→initialize→행순회. 빈/전부skip/정상페이지에서도초기화실패는전체실패.
- 오류코드: source/config/fetch/JSON=INSTRUCTOR_NOTION_SOURCE_FAILED, initialize=INSTRUCTOR_NOTION_INITIALIZE_FAILED, mapper=INSTRUCTOR_NOTION_MAPPING_FAILED, 행조회/쓰기/감사=INSTRUCTOR_NOTION_ROW_FAILED. 공통응답helper미수정. mapper는try밖동작을안전한전체실패로재포장하며앞행commit보존.
- 원본mapper/stripPii해시고정. 정규화는새UUID/createdAt/updatedAt/profile.syncedAt/notionSyncedAt/감사시각만지정. fixtureID/NO/배열순서/실패위치유지.
- 실제numeric PG17.9 probe exit0,45migrations적용: 0/-1/Int32양끝허용. 소수는Math.trunc(0.5→0,1.5→1,-1.5→-1),경계소수2147483647.5/-2147483648.5도절단후허용. 범위초과2147483648/-2147483649 및NaN/±Infinity는findUnique에서행errors,write0. Mongo adapter의조회/저장에동일절단후Int32범위확인; mapper/preview의원래NO문구는그대로. 새skip정책아님. 숫자분류표근거numeric-probe-main.log; probe최초fork EPERM미실행후메인실행성공.
- 같은문서경합은기존manual두메서드실호출,양방향barrier로실conflict/retry확인. callback매retry마다매칭/현재값/OR/document/audit재작성. 같은이름최초생성은별도행가능,후행manual명시false/profile은직렬결과허용; 기존PG동시성한계와구분.
- dryrun업무/ActivityChange/guard무쓰기; 실제GET ActivityRequest는기존대로별도best-effort.
- 동일profile재암호화·nullablecreate 감사는실PG대조후차이를명시하거나sync범위내보완;자동PASS금지. 전체30초deadline/ciphertext동일성/복수legacy동일승자보장없음.
- 마지막Step은validation-v2각기준실행대조이며필수실패없음/독립리뷰수락후에만완료.
