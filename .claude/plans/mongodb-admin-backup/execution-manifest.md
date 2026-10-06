# 관리자 백업 실행 기록

기준f0b3e479d140a81e78f2a73ddf7c74063fd8e14f, branch feature/20260930-mongodb-admin-backup, 격리 clone. 구현/검증 진행 중이며 아직 완료/통합하지 않았다.

## 현재 환경

Node24.19.0, PG17.9, Mongo8.0.30. 새 소유root /private/tmp/hub-om-admin-backup-20260930. PG56756/admin_backup_test synthetic(45migration 적용 완료), Mongo27856/adminbackup20260930 replica, dbpath 각각root/pg·root/mongo. 소유PID9806/9820의 command/path 확인을 owned-processes.json에 저장했다. enableTestCommands는 새로 기동한 검증서버에만 적용했다. 빌린 mongod binary는 삭제하지 않는다.

명시 env-i로 운영환경을 전달하지 않았다. Prisma config는 dotenv 로드를 시도하지만 이 격리clone의 .env/.env.local은 둘다없음을 확인했고 injected0이었다. 실제env/키/원천/운영DB 접근 없음. 테스트 임시키는 runner가 매번 생성한다.

## 초기 검사

부모작성 PG repository/factory/context/route에 typecheck-initial PASS. 독립 PG route review와 plan/metareview 수락. 기존privacy/auth/activity/codec/schema/package/loader15파일은 baseline hash동일. 전체기능·actualPG/native·일반test/build/lint와독립실행리뷰는 아직NOT_RUN이다. logs와run-check.py는 소유root에 보존한다.

## 명시 차이와 한계

기본PG 기존조회유지. 명시Mongo만 단일snapshot·누적행/byte/time보호한계, 초과면전체reject. 고정 ADMIN_BACKUP_READ_FAILED는cause없이reject되며 withActivity는기존500감사를기록한다. 직접POST호출rejection을 실제NextHTTP오류응답검증으로주장하지않는다. archive6필드밖의손상암호문은읽지않는다. 현재endpoint는전체DB/복구백업이아니며운영복원/전환증거로사용하지않는다.

## 중간 검사

실제POST/auth/withActivity와합성IO scope root+15=16PASS/0skip. native정적리뷰·scope정적리뷰수락. initiallint0errors/기존7warnings. 최초build는AdminBackupData mappedtype이 asconst의readonly를상속하여native응답구성할당에서TS2540 발생. 부모계약을 -readonly mappedkey로명시하여보완했다(런타임변경없음). 최종build/typecheck미실행, actualPG/native준비중.

## 최종 검사 및 명령

일반1061PASS/97 opt-in skip/0FAIL, scope16PASS(일반의부분집합), 실제Mongo15PASS/0skip(root+14), 실제PG frozen original/current ×UTC/Asia-Seoul 각11사례=44관찰/root1PASS/0skip. typecheck-final/build-final PASS, lint-final 오류0/기존경고7. 중복합산하지않는다. 전체과거Mongo묶음을새로돌린것은아니며변경없는privacy/auth/activity/codec/schema/package/loader15파일hash로기존검증을재사용한다. 일반검사후변경은PG opt-in runner경고허용목록과digest2파일뿐이며actualPG·최종type/lint로재검증했다.

소유root/run-check.py가명시환경과임시키로 npm test/typecheck/lint/build를실행했다. native: node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/adminBackup.integration.test.ts. PG: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --import ./scripts/test-admin-backup-baseline-loader.mjs --test src/lib/data/admin-backup-tests/baseline.postgres.integration.test.ts. ADMIN_BACKUP_DATABASE_TESTS=1 및고정소유PG/Mongo URL만허용한다. native는자체임시키생성, PG는부모임시키. 검사·실패로그/runner/hash/소유정리근거는영속cache로복사했다.
