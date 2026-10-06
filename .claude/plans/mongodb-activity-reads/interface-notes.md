# 활동 조회 구현 경계 초안

파일 `src/lib/data/activityReads/activityReadRepository.ts`:
- `ActivityFilters = ReturnType<typeof activityQuery>`
- `ActivityFeedFilters = ReturnType<typeof feedQuery>`
- `ActivityUsageFilters = ReturnType<typeof usageFilters>`
- `ActivityLegacyWhere = Prisma.CoachContentEntryWhereInput | null`
- `ActivityRequestRow = Omit<ActivityRequest, "actorEmailPiiIndex" | "actorNamePiiIndex">`
- `ActivityChangeRow = Omit<ActivityChange, "actorEmailPiiIndex" | "actorNamePiiIndex">`
- `ActivityPresentedChange = ActivityChangeRow & { targetLabel: string | undefined; labelSource: string | null; targetHref: string | null; description: string | undefined }`
- `LegacyActivityRow`: 기존 legacy 응답 필드 그대로(Date occurredAt,actorName/email nullable,actorType user,targetType coaches,targetId/targetLabel/action/description/route/method,legacy true,changes {},targetHref nullable,labelSource 현재 정보).
- `ActivityPage<T> = { entries: T[]; nextCursor: string | null }`.
- `ActivitySummary={requests,changes,errors,users:number}`; `ActivityUsage=ActivitySummary & {automatedRequests:number}`.
- `adminList(filters):Promise<ActivityPage<ActivityRequestRow|ActivityPresentedChange>>`
- `legacyList(where):Promise<ActivityPage<LegacyActivityRow>>`
- `feed(filters):Promise<ActivityPage<ActivityRequestRow|ActivityChangeRow> & { summary: ActivitySummary|undefined; fetchedAt:string }>`
- `usage(filters):Promise<ActivityUsage>`

Factory `getActivityReadRepository`, context key `activityReads`, PG class `PrismaActivityReadRepository`. 파서/권한/headers/usage의date와fetchedAt생성은route유지. feed의fetchedAt은원본처럼repository transaction내부에서생성한다. 원본privacywrapper를통과하는query/select와transaction설정그대로PGadapter로이동한다.

`src/lib/activity/presentation.ts`의기존describeChanges(db,rows)는유지하되DB조회결과를명시 `ActivityLabelRows`로추출하는 `loadActivityLabels(db,rows)` 및순수 `formatActivityChanges(rows,labels)`로분리한다. labels fields는기존6조회정확select에맞는 operations/coaches/courses/companies/notes/engagements배열. sharedformatter의JS exactmatch를변경하지않는다. legacy는별도순수formatter로중복최소화가능하나PGoracle는공유하지않는다.

Mongo file `src/lib/data/mongoActivityReadRepository.ts`, exports ACTIVITY_READ_MODELS / MongoActivityReadOptions / MongoActivityReadError / prepareMongoActivityReadStore / MongoActivityReadRepository.open. 모델은 ActivityRequest,ActivityChange,CoachContentEntry,Coach,CoachEngagement,OperationSession,Course,Company. prepare만allowShadowWrites명시,open은read-only옵션MongoOperationOptions와readiness검사. 모든read전체8초budget/snapshot,scan기존15초32MiB20k와총기한중빠른한도. 전체조건을다루는범용Prisma인터프리터를만들지말고이4입력의알려진필드/조건만처리,미지원failclosed. 전체인증후정렬/51선택,공개count도fullrow한도의추가안전제약으로문서화.

제품코드작성전최종계획검토에서정합성을확정한다. workers는명시파일만작성,실DB실행은main이담당.
