# 실행 매니페스트

기준 `75125c9644d6c8265fbdae59e5c9d450247170ef`, 별도 clone의 `feature/20260930-mongodb-import-promotion`. 원본 workspace에는 쓰지 않는다. 제품·검사는 완료했으며 최종 코드·회귀 증거를 독립 수락했고 문서·증거 보존·정리까지 독립 수락했고 원격 통합을 대기한다. 아래 개별 묶음은 서로 중복 합산하지 않는다.

## 변경 파일과 목적

- `importPromotionContract.ts`, `importPromotionCore.ts`: 기존 반영 결과/순수 변환/분기와 transaction port.
- `prismaImportPromotionRepository.ts`, `importPromotionService.ts`: 기존 PG 쿼리를 adapter로 옮기고 기본 PG 유지.
- `mongoOperationRepository.ts`: 원본 PG 전체 tuple 비교에서 발견한 INSERT nullable 감사 누락 보완. 실제 신규 Company/Course/OperationSession만 complete row 필드 force, UPDATE/다른 writer/helper 정책 유지.
- `mongoImportPromotionRepository.ts`: 명시 shadow 준비/쓰기, 전체 transaction 감사·참조·shared counter/guard, 제한된 자연키 재시도와 총 예산.
- `dataRepositoryContext.ts`, `importPromotionEffects.ts`, 실제 promote route: 명시 저장/명단/Calendar scope 선검사, commit 후 효과, 비정형 오류 고정 문구.
- `importPromotionOriginal.fixture.ts`, `original-route.fixture.txt`, `original-digests.json`: 기준 원본의 독립 oracle. 제품 core를 공유하지 않는다.
- `importPromotion.postgres.integration.test.ts`: 실제 격리 PG 원본/current/Mongo의 값·감사·재실행·실패 대조, 실제 PG 경합과 직렬 결과. 실제 Mongo 네 insert 경합을 원본 PG의 실제 겹친 호출 일정 전체 tuple과 직접 비교했다. 최초 감사 누락 실패를 보존하고 제품 보완 뒤 pg-race-fixed54 통과.
- `mongoImportPromotionRepository.integration.test.ts`: 실제 Mongo 저장·경합·준비 상태와 명시 오류/시계 주입.
- `mongoImportPromotionHandlers.integration.test.ts`: 실제 POST/권한/context/native DB/합성 Calendar와 동결 route 실패 상태표.
- 기존 staging handler test: 새 promotion 필수 scope 누락이 PG getter보다 먼저 실패하는 기대 반영. 직접 PG getter 차단 검사 유지.
- 기존 OM 두 test: 새 소유 합성 주소/replica 정확한 allowlist 추가. 업무 assert/timeout 완화 없음.
- 이 계획 폴더 및 operations 경계·coverage·macro·잔여 작업 문서: 구현 범위와 미완료 구분.

## 규칙→검증 추적

| 계획 | 실행 파일/근거 | 상태 |
| --- | --- | --- |
| §1 context/API 선검사 | mongo-parent-fixed.log | 최종 API22 pass/0 skip/exit0. 실제 Company 경합 두 건의 Calendar 횟수와 필수 부모 누락 포함. 실제 서버 장애와 fault injection 구분 |
| §2 원본 알고리즘·값·감사 | pg-parent-fixed.log | 최종 54 pass/0 skip/exit0. 원본 PG overlap과 Mongo 네 경합의 전체 tuple 대조 |
| §3~4 atomicity/참조/guard/counter | mongo-parent-fixed.log | 최종 저장60 pass/0 skip/exit0. 필수 부모/blocked 고아 source 추가. 동시성 원본 대조는PG54묶음 |
| §4 numeric/기본값/sequence | pg-parent-fixed.log 및 mongo-parent-fixed.log | 원본 PG 반올림·실패 결번과 Mongo rollback 구분 |
| §5 commit 전/불명/후/효과 | mongo-parent-fixed.log | callback/ACK 오류 주입은 실제 프로세스 crash가 아님 |
| §6 전체 회귀/독립 수락/정리/통합 | unit/typecheck-final/lint/build/full-mongo-first 등 | 일반922pass/71skip, type/build exit0, lint0/기존7warning. Mongo파일별최종833, 소유정리완료. 독립코드/회귀수락완료, 문서/증거/정리수락완료·원격통합대기 |

실행 환경은 Node24.19.0/env-i, PG17.9 56739, Mongo8.0.30 replica27839. 임시 경로 `/private/tmp/hub-om-import-promotion-20260930`. 최종 보존 로그54개/digest는 `/Users/ga/.cache/hub-om-verification/20260930-import-promotion`에 있다. source16개와 regression-by-file.json을 함께 대조한다. 실제 운영 DB·원천·Calendar·배포·백업·복원 실행은 없다.
