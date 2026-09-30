**전체 schema는 실제 적용하되, seed는 반환 대상 11모델과 snapshot metadata로 제한하는 방식이 적합합니다.** 35모델 전체 검증을 반복할 필요는 없습니다.

- **원본 동결:** `f0b3e479d140a81e78f2a73ddf7c74063fd8e14f`의 실제 [backup route](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/admin/backup/route.ts), 권한 guard, `withActivity`·retention, getPrisma·privacy·context runtime closure를 Git blob/hash로 고정합니다. 기존 health resolver 방식을 확장하고 실제 NextResponse·Prisma를 유지합니다. 합성 seam은 낮은 수준의 `@/auth` 세션 반환만 허용하며 original/current는 별도 process로 실행합니다.

- **최소 합성 seed:** live/deleted Coach, null/non-null 개인정보·DATE·source ID, 두 composite 연결, 일정·참여·취소 상태, importRun의 SQL NULL/JSON null/중첩 JSON을 구성합니다. `operationSessionId=null`로 시작하면 추가 업무 부모 seed를 피할 수 있습니다. snapshot은 **22개 정도**로 최신20 경계와 동률을 구분하고, 제외 필드에도 별도 canary를 둡니다.

- **본문 비교:** 11배열은 순서 없는 **전체 DTO bijection**으로 비교합니다. `CoachPrivateProfile`은 `coachId`, `CoachField/CoachCurriculum`은 `coachId+tagId`이므로 전부 `.id`로 비교하면 안 됩니다. 중복 키를 먼저 거부하고 null·누락·추가 필드도 구별합니다. 승인된 복호화 개인정보는 응답에 포함되어야 하며, HMAC/helper/envelope만 제외합니다. SQL NULL과 JSON null은 HTTP에서 둘 다 null이므로 seed의 raw 상태에서 별도로 확인합니다.

- **최근20 oracle:** 반환 필드는 정확히 `id/table_count/row_count/status/started_at/finished_at`입니다. 비동률 fixture는 선택 ID와 순서를 literal로 고정합니다. 동률 fixture는 날짜 내림차순·20개·중복 없음·경계보다 최신인 행 전부 포함을 검사하고, 경계 동률 집합에서는 허용되는 부분집합을 인정합니다. 원본에 없는 `id` tie-break를 요구하거나 임의 재정렬로 선택 오류를 숨기면 안 됩니다.

- **실제 route 사례:** 빈 DB, 풍부한 DTO, 최신20 경계, 올바른 secret, secret 없이 허용 admin, 잘못된 secret+허용 admin, 권한 거부를 최소 묶음으로 권합니다. 잘못된 secret은 세션 guard로 넘어가며, 원본 권한 거부는 **throw**입니다. 임의의 HTTP403 계약을 만들지 않습니다. 전체 응답·counts·헤더·파일명·exportedAt을 검증하고, `withActivity` 완료 후 요청 audit을 확인합니다.

[기존 admin 통합 fixture](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminDatabaseHandlers.integration.test.ts)의 실제 guard/withActivity, 세션 seam, 암호화 audit·raw 불변 검사는 재사용할 수 있습니다. 다만 이 fixture는 Prisma를 tripwire로 대체하므로 **실제 PG 근거로 사용할 수 없습니다.** `mongoCoachFixtures`도 seed 보조로만 쓰고 기대 DTO는 독립 literal로 둡니다.

특히 [request activity](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/request.ts)는 audit INSERT와 retention을 수행합니다. 따라서 “전체 DML 0” 대신 **backup 대상 원본 불변 + 요청 audit 정확성**을 판정해야 합니다. 원본 read 자체도 transaction snapshot이 아니므로 동시 일관성까지 PG 동등으로 주장하지 않습니다.

파일 변경·테스트·DB 실행은 하지 않았습니다.
