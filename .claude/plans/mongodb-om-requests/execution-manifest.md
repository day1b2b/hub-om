# Execution Manifest
基準383d804,작업전clean. 이번src변경은아래와같고사용자원본workspace수정없음. checksum은verified-source-digests.json.

## Plan 매핑
1 원본계약:원본fixtureSHA5228368...,mapping/legacy분리,PG69관찰×3backend.
2 후속배정기준:source-findings/운영문서만;이번에는4entrypointscope차단만구현.
3 저장:MongoOmRequestRepository,기존정책codec/schema무변경,partial쓰기/원자감사/누적deadline.
4 호출:실POST/PATCH/DELETE/page,context+부수작업port,기본PG/local유지,오류비노출.
5 검증:실PG5pass(69관찰각backend),OMnative+handler31pass,일반916pass60skip,전체Mongo590pass,static통과. V12 추가handler19pass/typecheck통과,제품동일. 독립최종리뷰PASS.
6 문서/정리/통합:합성재cleanup완료,독립리뷰PASS,commit/push/remotegate대기.

## 변경/신규src
- src/app/api/om-request/[id]/route.ts
- src/app/api/om-request/route.ts
- src/lib/data/dataRepositoryContext.ts
- src/lib/data/mongoOmRequestHandlers.integration.test.ts
- src/lib/data/mongoOmRequestRepository.integration.test.ts
- src/lib/data/mongoOmRequestRepository.ts
- src/lib/data/mongoOperationAudit.ts
- src/lib/data/notionTeamMemberRepository.ts
- src/lib/data/omRequest.postgres.integration.test.ts
- src/lib/data/omRequest/legacyOmRequestRepository.ts
- src/lib/data/omRequest/omCustomToolsLocalRepository.ts
- src/lib/data/omRequest/omRequestAssignment.ts
- src/lib/data/omRequest/omRequestBoundary.test.ts
- src/lib/data/omRequest/omRequestLocalRepository.ts
- src/lib/data/omRequest/omRequestMapping.ts
- src/lib/data/omRequest/omRequestOperationLink.ts
- src/lib/data/omRequest/omRequestOriginalRepository.fixture.ts
- src/lib/data/omRequest/omRequestRepository.ts
- src/lib/data/omRequest/omRequestRepositoryFactory.ts
- src/lib/data/operationRepositoryFactory.ts
- src/lib/data/teamMemberRepositoryFactory.ts
