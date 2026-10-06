# 실행 검증

기준 b401626 → feature/20260929-mongodb-deleted-operations. Node24.19.0/PG17.9/Mongo8.0.30. 새runtime /private/tmp/hub-om-deleted-operations-20260929, PG56629/deleted_operation_parity/Mongo27729 deletedops20260929. env-i·합성자료·임시키만사용, 실제운영/원천/키/설정변경없음.

## 확인된 결과
- 초기 deleted.log: 테스트출력40pass/0skip/0fail이지만 실행wrapper exit2로전체실행성공판정하지않음. 실행중run.sh재작성후parse위치어긋남이원인으로추정되며현재bash -n은통과. 직접Node로별도 deleted-final.log 재검증완료: 40pass/0skip/0fail 및직접프로세스 exit0 확인. 검사항목: PG원본·PGadapter·Mongo독립oracle 시나리오, 실제admin/withActivity/context, Mongo경합/원복/paging/시간/키/HMAC 검증.
- 일반 unit.log:889pass/36skip/0fail. opt-in skip은PASS아님. 별도실DB검증과합산하지않음.
- typecheck/build PASS, lint 오류0/기존경고7.
- broadMongo 최종280pass/0skip/0fail, mongo-bundle.log 및프로세스exit0. 기존/신규/직전단위native 포함, mock검사4개포함. 신규40묶음과중복합산금지. 코드리뷰P0–P3지적없음, 독립최종수락후속기록.

## V1–V10 증거
V1/V8 handler: exactempty/space/case구분, malformedJSON400/null예외, admin거부/미설정scope/Mongo오류PGfallback없음, 요청감사실패업무성공유지.
V2 PG/native: 8필드·UTC날짜·삭제시각desc(동률별집합비교), 관계snapshot경합·고아관계실패.
V3/V4 PG45migration 원본query/newPG/Mongo: 반복updatedAt갱신, 삭제자/HMACnull, staleactor활성행정리감사없음, restore감사, 비관련raw·관계보존.
V5 native 실제세션/감사쓰기후실패전체원복, 승인응답만복호화·저장/오류평문비노출.
V6 native barrier실제code112, update/delete/coursebulk 양쪽선행·동시복원감사1. bulk대상제외와active조건실패를구별한다.
V7 실제101행/BSON짧은batch/32MiB한도, 가상scan15s/transaction30s/실충돌후20s+15s누적deadline 실패원복.
V9 원본PG query독립oracle 고정fixture9개행, empty/space/case/missing/deleted/live/staleactor, 실제audittrigger 의미비교.
V10 일반889/36skip 및broad280/신규40/static 통과. 독립최종수락·정리/push/SHA/통합은후속기록.

## 한계
실OAuth·브라우저E2E·실데이터·원천·운영부하·복구리허설·운영전환은미실행. 가상시계deadline검증은실30초대기/장시간네트워크부하와다르다. 전체writer직렬화/미래bulk대상포함보장없음. 동률정렬/기존UI선택별실패표현은변경없다. 새schema/migration/dependency/운영selector없음.

## 실행
로컬보존로그는 runtime/logs. env-i로 run.sh static/deleted/mongo 실행. Node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test 신규테스트4파일. broadMongo는 --test-concurrency=4로격리검증동시부하제한. npm test/typecheck/lint/build. 각최종건수와exit확인.

초기독립Gibbs리뷰: 코드P0–P3지적없음, V1–V9 구현·증거적합. V10은직접Node정상exit와broad최종결과를확인한뒤판정. wrapper exit2를PASS로처리하지않음.

## 독립 최종 수락
Gibbs가V1–V10기능·실행검증PASS로수락했다. 남은P0–P3코드차단지적없음. 최종로그40/280/889·36skip 및정적검사대조, 초기wrapperexit2는실패이력으로유지. cleanup/push/통합은별도인계단계다.

소유합성자원정리완료: Mongo getCmdLineOpts dbPath/replica이름 확인, 남은합성DB0, PG/Mongo정상종료와잠금/프로세스파일정리확인후소유dbpath2개제거. 경로부재와cleanup.log exit0확인. 로그/스크립트보존, 다른namespace/운영접근없음.
