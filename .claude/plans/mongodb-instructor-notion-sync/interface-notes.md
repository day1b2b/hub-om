# 저장/원천 인터페이스 초안

- InstructorNotionRecord = 기존 mapper의 NonNullable<ReturnType<typeof mapPageToInstructor>>. 별도업무필드추가없음.
- InstructorNotionMatch = { target: {id:string,instructorName:string,recruitAvoid:boolean}|null; by: "notionNo"|"legacy"|"none" }.
- InstructorNotionSyncRepository.initialize(): void (원천수집뒤/행catch밖에서1회; PG기존getPrismaClient 구성검사, Mongo open후no-op).
- InstructorNotionSyncRepository.findMatch(record): Promise<Match>, applyRecord(record): Promise<"created"|"updated">.
- InstructorNotionSource.readPages(): Promise<JsonObject[]>.
- workflow runNotionInstructorSync(pages,repository,dryRun): 원래mapper/집계/preview분기를그대로이동. applyRecord가행단위쓰기전체소유,source는workflow진입전에전체읽음.
- PG.findMatch는원본select/no-priority+legacyquery. PG.applyRecord는findMatch후원본patch/create,기존sequential/nontransaction경합한계유지.
- MongoInstructorNoteRepository implements 기존NoteRepository 및새SyncRepository. findMatch는NOone후privateexact+NO null;applyRecord는기존transaction안에서전체재조회와기존save로암호화/auditcommit. 기존manual메서드변경없이공통writeconflict참여.
- factory는scope존재시두port필수. defaultPG생성자에는연결없음. facade에서두factory해결후source호출,전체sourcefailure고정INSTRUCTOR_NOTION_SOURCE_FAILED. perrow오류INSTRUCTOR_NOTION_ROW_FAILED(이름/ID/drivertext없음).
- withActivity 유지: GET업무/guard무쓰기와별개로기존RequestActivity 기록은발생할수있음. POST업무ActivityChange는transaction,요청ActivityRequest는best-effort별도. 권한거부는원래syncJsonResponse500/admin문구유지.
