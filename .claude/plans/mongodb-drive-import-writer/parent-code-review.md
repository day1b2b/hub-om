**차단 P2 1건입니다: 원본이 허용하는 큰 `--limit`를 Prisma `take`에 그대로 전달합니다.**

[prismaDriveImportWriterRepository.ts:21](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/prismaDriveImportWriterRepository.ts:21)

- 원본 `--limit 9007199254740992`는 유한 양수라 그대로 유지되고, PostgreSQL bigint 범위의 SQL `LIMIT`로 실행 가능합니다.
- 새 구현은 같은 값을 Prisma `take`에 전달합니다. 기존 동일 프로젝트의 [기술 gate 기록](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-drive-import-history/technical-gate.md:9)에서는 `MAX_SAFE_INTEGER+1`과 `±1e18`이 정상 조회되지 않는 것을 확인했습니다.
- 따라서 소량의 운영대상만 있어도 원본은 처리하지만 새 기본 PG 경로는 `DRIVE_IMPORT_WRITER_FAILED`로 중단할 수 있습니다. 승인된 유한 양수 floor 계약과 어긋납니다.

**최소 보완:** 원본 SQL이 허용하는 큰 limit를 Prisma의 지원 범위에 맞게 처리하고, 위 입력을 원본/현재 PG에 동일하게 넣는 회귀 기준을 추가하세요. 원본도 거부하는 값까지 무조건 clamp하여 성공시키면 안 됩니다.

나머지 검토 범위에서는 구체적 차단 결함을 발견하지 못했습니다. 암호화 wrapper 경유, RepeatableRead 조회, gate에 맞춘 날짜 변환, JSON 직렬화, missing-run UPDATE 의미, 고정 repository 오류, context의 타입 슬롯 추가는 계약과 일치합니다.

이번에는 코드·기존 증거만 읽었습니다. 새 writer의 위 반례 실행, DB 접근, 파일 수정은 하지 않았습니다.
