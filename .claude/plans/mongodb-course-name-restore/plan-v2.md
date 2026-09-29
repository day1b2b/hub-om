# 과정명 복원 실행 계획 v2

plan-v1 Core1–3/역할/제약을 유지한다. validation-v2가 최종수락기준이다.

내부 CourseNameRestoreGuard는 기존패턴의 고정 singleton으로 필수 적용한다. 최초 및모든retry에서 guard nonce쓰기→readPlan→처음제출snapshot비교. guard는hash에포함하지않아다른courseId를무조건stale처리하지않는다. firstupsert/unique경쟁도총30s예산에포함한다. PG는기존15s/maxWait5s, Mongo는총30s이며동일timeout을parity로주장하지않는다.

업무schema/PGmigration/35모델은변경하지않지만내부coordination컬렉션은추가된다. processSeq counter를잠금에소비하지않는다. explicitprepare에processSequenceHighWater:number를받아기존__counter를높이고open은최대course값/validator/index/guard를읽기검사한다. 실제newcourse생성에만counter증가. 전체준비에productionfallback없음.

Mongo지문범위는원본readPlan projection: 같은정규화courseId의모든Course필드·company.name·active session의선택필드·최신source2개(id/createdAt/mappedFields)다. 과거source/삭제session다른필드·무관courseId·guardnonce/암호문/HMAC는제외. backend간hash교환은지원하지않는다.

역할interface 메서드명 planCourseNameRestore(rawCourseId):Promise<CourseNameRestorePlan>, applyCourseNameRestore(rawCourseId,operationIds,snapshot,actorEmail):Promise<CourseNameRestoreResult>. exportscontract CourseNameRestoreConflict/types. main은facade/PG/factory/context/handlers를담당. legacydb주입을기본context밖에서유지하고명시context에선차단한다.
