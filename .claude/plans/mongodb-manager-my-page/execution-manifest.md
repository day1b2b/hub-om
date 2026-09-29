# 실행 매니페스트

기준 bc77a12758bd060a4194b6489dd14c4eaa63074d, 브랜치 feature/20260929-mongodb-manager-my-page. 지속 clone /Users/ga/workspace/hub-om-mongodb-coach-content 재사용. 원본 workspace/총괄 clone 수정 없음.

## 구현·연결

- coachManagerMyPageRepository/interface, prismaCoachManagerMyPageRepository, factory, dataRepositoryContext.
- 기존 coachMyPage facade/type export, coachMyPagePresentation의 순수 DTO/group/partition.
- MongoCoachManagerMyPageRepository: 5모델 읽기, HMAC/원문확인, bounded 복호화 검색, 메서드별 snapshot.
- 실제 app/coaches/my-page/page.tsx는 파일 변경 없이 기존 facade 호출로 연결. 기존 admin guard·세션 email·UTC today 유지.
- schema/migration/dependency/업무필드/삭제정책/생산 selector 변경 없음.

## 검증 파일

- coachManagerMyPageFixtures.ts: 양 저장소 공용 합성 fixture 및 수동 고정 기대값.
- coachManagerMyPagePostgres.integration.test.ts: 45 migration, bc77a12 독립 predicate, actual PG/Mongo 및 조회 전후 불변 비교.
- mongoCoachManagerMyPageRepository.integration.test.ts: 계약·다중 페이지·동시 변경 snapshot·암호화·손상·readiness·크기 제한, 시간초과 오류 주입 후 부분 응답 금지.
- mongoCoachManagerMyPagePage.integration.test.ts: 실제 page/admin guard, 세션 공급과 자식 UI만 대체, context factory·누락·격리·세션 identity·빈 props·partition.
- mongoCoachScheduleRepository.integration.test.ts: 전체 회귀에서 발견한 기존 감사실패 주입 순서를 실제 _id scan 순서와 일치시킨 테스트 수정. 업무코드 변경 없음.

## 환경·실행

Node24.19.0, PG17.9 C locale, Mongo8.0.30 단일 replica set. env-i·임시 random keys·합성 데이터만 사용.
소유 root /private/tmp/hub-om-manager-20260929, PG56589/manager_my_page_parity, Mongo27689/manager20260929. 고정 run.sh의 static/manager/mongo/native-final 모드로 검증. 외부 실원천/운영 env 로드 없음.

## 발견·수정

1. macOS PG 초기화 후 startup locale 오류: LC_ALL=C/LANG=C로 격리 실행 고정.
2. actual page 추가검사의 implicit-any: 명시 테스트 DTO 타입으로 수정, 최종 typecheck 확인.
3. 독립리뷰의 timeout 근거 요구: 공통 scan 실제 마지막 페이지 이후 가상시간 초과 검사와 신규 메서드 오류 주입 검사를 연결. 실제 네트워크 30초 지연/부하 검증과 구분.
4. 전체 Mongo 회귀189pass2fail: 기존 취소 감사 테스트의 자연순서와 실제 _id scan 순서 불일치. 둘째 감사실패/rollback assertion을 유지해 정렬하고 해당14검사 재통과. 전체 단일 실행을 성공으로 재표기하지 않는다.
5. cleanup의 getCmdLineOpts replication 이름필드 검사 실패: 자원 변경 전에 중단. hello.setName으로 이름 확인 후 정상 정리 완료.

최종 수치·한계·독립 판정은 execution-review.md, 인계는 handoff.md 참조.
