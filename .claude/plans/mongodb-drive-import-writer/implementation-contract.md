# 구현 계약 — 기술 gate 후 코드화

실제 기술 gate 통과 후 계약/source/default PG/context 파일을 작성했다. workflow/native와 검증 파일은 병렬 구현 중이다. 아래는 현재 구현자가 공유하는 계약이며 제품 검증 완료를 뜻하지 않는다.

- `src/lib/data/driveImportWriterRepository.ts`: 기존 OperationSession의 CLI조회10개필드+id를표현하는 DriveImportOperation, DriveImportArgs, DriveImportInput, DriveImportResultInput, DriveImportSummary, DriveImportWriterRepository 계약.
- repository 메서드: loadOperations(limit)→operations, createRun(args,operationCount)→runId, appendResult(runId,operation,input,result)→void, finishRun(runId,summary,status)→void, close()→void. close는defaultPG명령소유연결정리이며borrowedMongo는no-op. programmatic workflow는소유client수명과분리하고CLI정상완료시에만기존처럼close후최종JSON.
- `driveImportSource.ts`: scan(value), search(operation)의기본함수는기존scanner, getDriveImportSource() 선택. source타입은기존Scan/Search결과를재사용. source는실제환경설정/cache를기존함수에맡기며테넌트별credential신규지원없음.
- `driveImportWriterFactory.ts`: getDriveImportWriterRepository() 기본Prisma/missing-scope실패. context슬롯 driveImportWriter, driveImportSource.
- `prismaDriveImportWriterRepository.ts`: 앱getPrismaClient encryption wrapper, query+create/update, 고정저장오류 DRIVE_IMPORT_WRITER_FAILED. 현재schema의default없는ID는Prisma생성. query의join/정렬/선택limit를보존하고기존driver의DATE출력의미를adapter에서맞춘다.
- `mongoDriveImportWriterRepository.ts`: prepareMongoDriveImportWriter(options allowShadowWrites:true), MongoDriveImportWriterRepository.open(options). models Company/Course/OperationSession/DriveImportRun/DriveImportResult. 준비선검증/명시shadow, load snapshot, append부모체크+짧은transaction, 안정적인append ID, finish원자update. sourceIO/summary집계는callback밖. fixederror동일.
- `src/lib/driveImports/driveImportDryRun.ts`: parseDriveImportArgs(argv,환경concurrency), runDriveImportDryRun(args, progress?callback)→{runId,status,summary}. 진입에서두port모두해석해scope누락을IO전에거부. 원본processing복사후최소포트치환, args/집계/부분쓰기/try범위/worker순서보존. progress는기존숫자문구. sourceerror는원본처럼Error.message/String으로암호화저장에보존.
- CLI `.mjs`는직접실행entry일때만원본envload→args→workflow→close→JSON,catch고정문구/process.exit1. moduleimport와명시context함수는env파일을읽지않는다. 실패시임의allSettled/전체rollback정책추가없음.

JSON 입력은원본SQL의JSON.stringify 의미를보존해야한다. omitted property/undefined배열→null/비유한수→null/BigInt오류를제품새기본값으로바꾸지않으며필요시JSONroundtrip을저장경계에서사용한다. SQLNULL 초기summary와최종JSON/[]를구분. 후보expected는제품정규화helper로만들지않는다.

원본이없는runId를finish(update0row)할때오류인지성공인지gate/원본조회로확인한다. 원본은rowCount를검사하지않으므로새강화정책을임의추가하지않는다. 신규native유한scan/read/write예산은상한초과fail-closed이며전체CLI/원천타임아웃으로주장하지않는다.

추가구현주의: 새PG load는기존하나의join SELECT snapshot을보존해야하므로Prisma관계별query가여러개면RepeatableRead read transaction을사용한다. native finish는기존전체행decode→완전encode뒤summary/status/집계/finishedAt만추출해atomic$set하며notes/mode/operationCount/startedAt/companion을덮어쓰지않는다. 이방식의손상된notes인증거부는PG updateMany보다엄격한명시fail-closed차이다. missingrun이어도원본JSON직렬화오류를삼키면안되므로JSON처리를먼저수행. summary의SQLNULL(MongoDbNull)/JSONnull(MongoJsonNull)구별을유지한다.
