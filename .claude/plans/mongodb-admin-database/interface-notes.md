# 구현 인터페이스 결정 초안

main 제공: src/lib/data/adminDatabaseRepository.ts — AdminDatabaseRepository { readDashboard(): Promise<DatabaseDashboardSnapshot>; updateCell(input:AdminDatabaseCellUpdate):Promise<void> }. input { table:AdminDatabaseTableKey; field:string; rowId:string; updatedBy:string|null; value:boolean|Date|number|string|null }. AdminDatabaseCellError(code:string), 고정message·원본driver내용없음.

src/lib/admin/databaseDashboard.ts는기존types/상수reexport+readDatabaseDashboard facade. 새 databaseDashboardPresenter.ts가원본DTO전체변환동일하게보유. buildDatabaseDashboard(input:AdminDatabaseRows):DatabaseDashboardSnapshot. data/adminDatabaseRows.ts는PGreadquery선택값구조를type-only참조하고Decimal을toString가능값으로허용(Date보존)한타입. PG readPrismaAdminDatabaseRows() returns기존16query명동일object {companyCount,companies,courseCount,courses,operationSessionCount,operationSessions,memberCount,members,dataImportRunCount,dataImportRuns,operationSourceRecordCount,operationSourceRecords,driveImportRunCount,driveImportRuns,driveImportResultCount,driveImportResults}. pgadapter class는readDashboard에서presenter호출,updateCell은기존분기그대로.

Mongoworker 소유: mongoAdminDatabaseRepository.ts, mongoOperationAudit.ts에Member공개두필드최소추가. ADMIN_DATABASE_MODELS 8조회모델+ActivityChange, prepareMongoAdminDatabaseStore(options), MongoAdminDatabaseRepository.open(options allowShadowWrites:true), readDashboard/updateCell. worker는기존prepare/store/codec재사용·Number money는PG numeric14,2 round-away-from-zero정확문자열로변환해야함. main테스트선행구조제공예정.

main소유: context.adminDatabase+teamMembers, getStoredTeamMemberRepository scope우선추가(getTeamMemberRepository는변경하지않고별도미전환명시), facade/route/PG/presenter/types/factory/factory단위검사/docs. Keplernative repository검사, Gauss PGoracle, 별도executoractualhandler/page검사로분리예정. 실제DB는main만실행.
