# 강사 Notion 실행 매니페스트

시작3dfa025,기존변경없음. 작업브랜치feature/20260929-mongodb-instructor-notion-sync. 계획v2독립수락후구현.

제품: instructorNotionSyncRepository(interface)/prismaInstructorNotionSyncRepository/factory, dataRepositoryContext 두port, instructorNotionSyncWorkflow, notionInstructorSync facade/source, 기존MongoInstructorNoteRepository sync methods. 기존GETPOST는facade호출을유지해새경계통과하며파일변경없음. mapper/PII정책/manual메서드/schema/의존성미변경.

검증: instructorNotionSyncWorkflow.test, mongoInstructorNotionSync.integration.test, mongoInstructorNotionHandlers.integration.test. instructorNotionSyncOriginalOracle.fixture.ts와 instructorNotionSync.postgres.integration.test.ts 추가. 동결oracle와mapper/PII checksum, 41상황x3단계x3backend 대조.

Step1 원본source/동시성조사·numeric실PG실측완료,oracle준비. Step2/3 제품경계구현완료. Step4 실제PG/Mongo/API검증완료,Step5 최종static/독립리뷰/정리완료. commit/push·총괄원격통합은integration-review에기록. HMAC후보부재legacy손상P2보완을중간독립검토후추가;20k/32MiB/15초 boundedfallback 한계문서화.

문서: 현재plan디렉터리/ops mongodb-instructor-notion-sync.md/macro-plan/남은이전목록. coverage/실행·인계갱신완료,통합은integration-review에후속기록.
