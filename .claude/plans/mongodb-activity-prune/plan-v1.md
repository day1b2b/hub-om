# 활동 정리 계획 v1

핵심은배치2개삭제의원자성·서버시각cutoff·retry/commit결과에대한집계와직접CLI실행을보존하는것이다. 단순기존Mongo.prune호출은순차삭제/각각Date.now라불충분하다. 새ActivityPruneRepository.pruneBatch/close를기본PG·명시Mongo로분리하고command에서drain한다. 신규CLI인자/보존기간옵션/삭제정책은추가하지않는다.

## S1 [Shell] 원본 및 시계 게이트
scripts/prune-activity.ts·retention.ts·getPrisma/privacy 의존성기준SHA를고정한다. PG기존10초transaction에서now()를두DELETE가공유하고모델별occurredAt ASC LIMIT1000·strict<cutoff를쓴다. 정확히1000이면다음배치를계속하고두수모두1000미만이면종료한다. 출력은deletedRequests/deletedChanges JSON이고defaultdotenv .env.local→.env의기존overridefalse순서유지. 원본이무시하던argv에새정책을추가하지않는다.

Mongo native 게이트로transaction내 collectionless $documents→$$NOW 단일서버시각조회가실제로지원되는지검증한다. 불가하면기존두collection의 projection을통해한번시각확보하며둘다비어있으면0반환한다. 새시계collection/필드는추가하지않는다. app Date.now를cutoff권한으로쓰지않는다.

## S2 [Core] 명시 port·CLI·원자적 Mongo
ActivityPruneRepository.pruneBatch():Promise<{requests:number,changes:number}>, close():Promise<void>, getActivityPruneRepository, context activityPrune. PG는원래transaction(pruneActivityBatch,{timeout:10000})를호출하고실제로초기화한client만close한다. command는scope누락을env/DB전에거부, 명시scope면env읽기0, 기본만기존env로드. loop합계는성공한배치마다한번증가, 실패시이전commit은남고성공합계JSON을내보내지않는다. import만으로env/IO/출력0, 실제scriptentry는기존npm명령으로동작, 에러는ACTIVITY_PRUNE_FAILED만출력/exit1, cause/raw로그없음. close실패도같이고정처리하고borrowedMongo는닫지않는다.

Mongo는2모델(ActivityRequest/ActivityChange)만준비·읽기/삭제한다. explicitallowShadowWrites true·shadowdatabase/namespace·키형식·validator/index·replica준비확인. 기존불일치자동수리/삭제없음. 배치마다같은transaction에서서버now1개로30/365일cutoff고정, occurredAt<cutoff/최대1000선택후삭제,2번째실패는첫삭제rollback. withTransaction callback안의cutoff/집계는시도별지역값이며transient라벨을보존하고바깥에서고정오류로변환. transaction10초·작업남은시간/cleanup5초제한;미확정commit을0삭제/rollback확정으로표현하지않는다.

기존API자동정리도PG와동일원자성이필요하므로같은2모델배치helper를재사용하는방안을우선검토한다. 외부recordRequest best-effort/매시간주기/고정로그/기존30·365일은바꾸지않으며자동정리4초·개별1500ms를CLI10초와구분한다. 이연결을하면관련실제API회귀를추가한다.

## S3 [Check] 실제 검증
frozenPG/currentPG/native에동일합성로그(없음/새것/만료/날짜동률/1000경계/두모델/연결된감사)를대조한다. 반환계수와삭제후전체raw다중집합·암호문불변, 두번째삭제장애rollback/후속배치실패부분commit/재실행0/retry한번집계/동시drain·commit실패를구분한다. 서버시간근거/두cutoff동일기준을검증하며PGmicrosecond와Mongo millisecond의물리시각동일성을추정하지않는다. ties의특정ID선택을원본보장으로만들지않는다.

실제CLI subprocess outputJSON/exit/close/import0·env순서·잘못된키/누락scope/nested/A-B·원문오류비노출을확인한다. 실제PG/Mongo gate와합성주입을분리하고관찰자단언은catch밖에서실행한다. 일반test/typecheck/lint/build·독립code/evidence검토, 변경된자동정리경로가있으면관련실제API재검증.검증불가를PASS로처리하지않는다.

## S4 [Check] 정리와 인계
소유행/연결/operation0확인후서버/포트/dbpath정리,증거영속화·macro/coverage/실행/정합/인계갱신,feature→총괄FF/atomicpush/remoteSHA확인. main/dev와운영전환은별도미완료유지.

## 실행 전 확정

실제Mongo8.0.30 snapshot transaction에서 collectionless $documents→$$NOW가Date1개를반환함을확인했다(root/clock-gate.json). callback시도마다1회사용으로확정. 기존API자동정리도공유원자적helper로연결한다. CLI10초/API4초·개별1500ms, retry로전체deadline초기화금지. 기존mongoApiContext/adminDatabaseHandlers native회귀를새URI로필수검증한다. ActivityChange는request/target FK가없으므로오래된request삭제로미만료change를연쇄삭제하지않는다.
