# 실행 매니페스트

기준 e1b97490eeded7cf34dc9c3e491fa3c4ef1d7235. 시작 clean clone, branch feature/20260929-mongodb-coach-content. 원본 사용자 workspace 변경 없음.

## 구현

- interface/PG/factory/context: src/lib/data/{coachContentRepository,prismaCoachContentRepository,coachContentRepositoryFactory,dataRepositoryContext}.ts
- Mongo: src/lib/data/mongoCoachContentRepository.ts
- 기존 메모 facade: src/lib/coaches/contentEntries.ts
- 실제 API: admin/content-entries, admin/schedule-registration/[yearMonth], coaches/[id]/notes, schedules/[yearMonth]/status route.ts. notes/[noteId]는 기존 facade 호출로 연결하며 파일 변경 없음.
- 관리 page/count: app/coaches/admin/page.tsx 및 coachAdminRepository, prismaCoachAdminRepository, mongoCoachAdminRepository.
- 실DB 비교로 발견한 공통 보완: mongoOperationStore.scan의 단일 묶음 keyset 조회, mongoOperationAudit의 CoachContentEntry enum/absent-null 구별. 기존 fake storage가 동일 공개 query를 지원하도록 mongoCoachWriteRepository.test.ts 보완.
- 기존 sheet sync integration의 조회관측은 첫 batched query와 마지막 empty page를 구분하도록 보완했다. 각 페이지의 원래 $in/HMAC filter 보존과 N+1 금지 의미를 유지한다.

## 검증 파일

- coachContentRepositoryFactory.test.ts: 기본선택·병렬/중첩 scope·PG 차단.
- mongoCoachContentRepository.integration.test.ts: 원자성·암호화·각 메모연산/purge 양방향·readiness·다중페이지·기한.
- mongoCoachContentHandlers.integration.test.ts: 실제 guard/withActivity/API·admin 페이지, 요청감사 장애·민감정보 비노출.
- coachContentPostgres.integration.test.ts: 모든 PG migration 및 감사trigger 적용, 고정 e1b9749 계약 fixture 비교, BSON 짧은페이지와 raw 명령 확인.

## 계획 연결

Plan v2 1–4 구현 완료. 5–6 합성 검증 진행/최종 결과는 execution-review 참조. 7 독립 코드 리뷰 지적 수정, 최종검증·인계는 execution-review/handoff 참조.

## 실행 환경

Node24.19.0, PostgreSQL17.9(C collation), MongoDB8.0.30 단일 replica set. env-i 및 임시키. 로컬 loopback만 사용. 런타임/로그: /private/tmp/hub-om-content-20260929. Mongo 배포파일 SHA256 172542980a64452b843fe126782c59e51f0c29359f536a3373035ab2fe0754f6.

검증 스크립트 checks.sh는 이 clone과 로컬 Mongo URI만 고정해 static/mongo/handlers를 실행한다. 각 하위 프로세스 종료코드를 합산해 실패를 숨기지 않는다. 환경 설치/기동은 실제 도구 승인을 받고 진행했으며 반복승인 불편 이후 가능한 동일 스크립트로 묶었다.

## 발견·수정 실패 이력

1. TSX component mock 로더 오류: 실제 admin page는 test-only TypeScript transform, 자식 UI만 대체하여 해결. production loader 변경 없음.
2. PG parity test의 driver error/reply unknown 타입 오류: 테스트 타입 보완. 이후 typecheck/build 재통과.
3. Mongo 7.2 일반 cursor getMore maxTimeMS 오류: 명시 maxTimeMS 제거만으로 미해결, cursor timeoutMS override도 tx에서 거부됨. 공개 singleBatch/keyset으로 해결하고 305행·BSON 짧은페이지를 재현검사.
4. 콘텐츠 생성 감사 NOTE 대소문자와 absent/null 표현 불일치: 해당 모델 감사 보완 후 실제 PG trigger 대조 통과.
5. 기존 fake CoachWrite find에 sort/$and/$gt 미지원: test double 지원 추가, 기존 업무 assertion 유지.
6. 독립리뷰의 기한 초과 마지막페이지 성공 가능성: page 종료 후 기한 검사 추가하고 네트워크 중단시간과 문서상 구별.
7. 전체 Mongo 회귀의 시트 쿼리횟수 1→2 assertion 실패: 조회내용 문제와 구분했다. 페이지별 원래 identity 조건 보존과 고정2회 batch+EOF 검사를 유지하며 최종 재검증했다.

어떤 실패도 과거 9/23 검증으로 대체하거나 PASS로 기록하지 않는다.
