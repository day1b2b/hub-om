# 관리자 백업 계획 v1

핵심은 저장모델전체행의 승인된복호화 응답을 유지하면서 companion/internal field가 유출되지 않고 12모델의 읽기/감사경계가 명시 context에 묶이는 것이다. endpoint는 전체DB복구 보증이 아니라 기존코치 JSON 다운로드이다.

대안A route에서 env분기/Prisma직접대체는 암묵backend전환·PGfallback 위험으로 거절. 대안B AdminBackupRepository.read():Promise<AdminBackupData>와 기본PG factory/명시adminBackup 선택. B를 채택하고 기존JSON응답구성·권한·activity는route에 유지한다. 새로운 streaming/정렬/중복/필드제거 정책을 추가하지 않는다.

## S1 [Shell] 원본 계약
원본route와 getPrisma/privacy/activity/auth 의존성 기준SHA를 고정한다. 11findMany(삭제포함 전체, 순서보장없음)와 raw snapshot의 snake_case6필드, started_at DESC/LIMIT20을 유지한다. 동일시간경계는 원본에도 tie정렬이 없으므로 임의새업무정렬을 보장하지 않는다. 날짜/JSONnull/nullable/피복호화/보조필드제거를 실제 PG와 독립literal로 비교한다. exportedAt/filename 시계만 통제하고 전체response headers/counts/data를 검사한다.

## S2 [Core] API·저장소
AdminBackupData는 기존11model의 공개scalar와 archiveSnapshots6필드로한정. PG는 기존조회그대로. Mongo 명시client/database/namespace, 기존codec/decryptRow등으로 Prisma공개fieldshape와 일치시키고 _id/_seq/codec/hmac/privacy보조필드를 노출하지 않는다. 명시scope adminBackup/requestActivity필수, 기존secret/admin guard를 우회하지않고 PGfallback0. auth오류제어흐름은유지, DB/codec오류는고정코드로변환하여 cause/raw로그없음.

Mongo 준비는기존collection 검사후missing만 생성하며 자동수리/삭제없음. open시준비·replica요건확인, 실제읽기는 한snapshot에서 순차boundedscan하며 총2만행/32MiB/60초와개별15초·cleanup5초 기존범위를 적용한다. 초과면 전체실패하며부분JSON을 반환하지않는다. 보관metadata는서버 startedAt내림차순limit20/projection으로불필요PII읽기제한. 업무쓰기0, borrowedclose0, readsessionfinally종료. PG의기존unbounded조회에새제한은추가하지않는다. 수치제한은Mongo기존검증안전한계이며새운영데이터정책이아니다.

## S3 [Check] 검증
실제PG 원본/current/native 내용대조(순서없는배열은id별비교), authsecret/session허용/거절과데이터접근0·감사귀속, 11model/20metadata/empty/deleted/nullable/JSON·날짜·sourceID암호화·HMAC비노출. 실제 GET아닌POST를 existingwithActivity로호출하고requestaudit별도쓰기와업무쓰기0을구분한다. A/B동시scope·누락/중첩·원문오류비노출, snapshot동시변경·raw암호문비노출·원문응답허용·budget/fault/cleanup·미준비collection거부를검증한다. 합성원천/키만사용하며 actualPGmigration/fullschema and actualMongo8 replica. 일반test/typecheck/lint/build/독립코드·실행리뷰; 범위밖기존검사는hash근거재사용.

## S4 [Check] 완료
소유합성자원정리·증거영속화·macro/coverage/remaining/실행/정합/인계갱신, 작업→총괄FF/atomicpush/원격확인. main/dev 조건미충족유지. 다음 활성CLI/전체앱조립 후보는코드사용처근거로선택한다.

## 코드 근거로 확정한 차이

archiveSnapshots는6필드projection만검증하고 전체codec을호출하지않는다. 원래rawSQL과같이 반환하지않는errorMessage암호문/HMAC손상은성공여부에영향주지않아야한다. 공개필드손상은실패시킨다. Mongo단일snapshot은원본PG Promise.all보다강한일관성을의도적으로제공하므로 정적내용만동등비교하고동시변경시PG와동일결과를요구하지않는다. 명시Mongo누적제한은검증용보호한계이며큰실운영백업지원완료로주장하지않는다.
