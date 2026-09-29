# 강사 Notion 동기화 Plan v1

핵심난이도: 원본NO/legacy매칭과수동필드보존을 Mongo 원자적write 및기존manualwriter와양립시키면서dryrun무쓰기/부분실패를보존하는것.

1. [Core] 원본계약확정. NO있으면해당행, 없으면이름exact+NO null인legacy, 없으면create. 이름/no갱신,notionId는truthy때만,recruitAvoid는현재OR원천,profile/syncedAt대체;수동3필드는보존. 매핑불가skip;행DB실패errors후다음행;source실패는전체실패. dryrun은각행을현재DB에대조하고가상앞행변경을적용하지않음. 산출source-findings/독립originaloracle. 수락: 원본과분기·집계·변경문구일치,오류text정제만의도된차이.
2. [Core] 작은read/mutation계약선택. 기본PG는기존select/update/create를유지. Mongo는기존MongoInstructorNoteRepository의transaction/save/audit 재사용해동기화행전체를snapshot에서재매칭후저장;실제documentwriteconflict/NO unique retry로manualwriter갱신유실을막음. dryrun은reader만,guard나감사쓰기없음. 이름은HMAC후원문검증;잘못된키/문서failclosed. 복수legacy첫행은기존미정순서한계기록. 산출repositoryinterface/PG/Mongo·workflow. 수락: manual3필드/recruitAvoid 보존,NO중복없음,감사실패rowrollback,다른rowcommit유지.
3. [Shell] factory/context에 instructorNotionSync/instructorNotionSource 추가, 두port를source.readPages전에해결. 명시scope누락시PG/source호출0. 기본source만기존Notionfetch를lazy호출,실제접속금지. 기존auth/withActivity/API응답형식유지;원천/행오류고정코드. 산출facade/factory/API실호출. 수락: bearer/admin권한기존동등/누락scope실패/인가된preview값정상.
4. [Check] 독립PG원본oracle로기본PG/Mongo 대조(원본helper그대로고정,UUID/실행시각만정규화),미리보기/초회/재실행/이름변경/legacy/동명다른NO/중복source행/invalidNO/부분실패/조건부ID/stripPII/OR검증. 실제Mongo암호화HMAC변조·수동writer경합·unique경합·감사rollback·dryrun무쓰기;실제GET/POST auth/원천실패/누락context/noPG/fetch0. 산출tests/logs. 수락: 핵심시나리오실행pass,미실행pass금지.
5. [Check] 전체일반테스트·Mongo묶음·PG단위·typecheck/lint/build 실행,독립실행리뷰로기준대조. 초기실패와수정증거보존,새변경없으면중복검사안함. 소유loopbackDB/합성키만,정상종료후소유dbpath정리. 문서/coverage/macro/남은차단목록업데이트,featurecommitpush·총괄통합·원격SHA일치확인. 수락: unresolved리뷰없음,완료근거와운영미완료구별.

대안: 별도Mongo저장class복제는manualsave/audit드리프트비용,기존class에좁은sync메서드재사용선택. 일반saveNoteByNotionNo만재사용하면legacy연결/OR원자성을표현못하므로거절. PG동시성확장은현재범위에서원본의순차쿼리계약을보존하고Mongo강화와한계구별한다.
