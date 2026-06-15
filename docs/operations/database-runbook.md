# 데이터베이스 작업 안내

이 문서는 PostgreSQL/Prisma 작업을 시작하기 전에 확인하는 운영 규칙입니다.

## 확정 기준

- DB: PostgreSQL 18
- ORM / migration: Prisma
- 호스팅: Coolify
- Prisma 연결 환경변수: `DATABASE_URL`
- migration용 직접 연결 환경변수 후보: `DIRECT_URL`
- MVP 테이블: `companies`, `courses`, `operation_sessions`, `data_import_runs`, `operation_source_records`
- Drive 조회 이력 테이블: `drive_import_runs`, `drive_import_results`

## 절대 금지

- 운영 DB에 백업 없이 migration 실행.
- 운영 DB에 백업 없이 import/write-back 실행.
- 실제 원천 데이터 직접 수정.
- 실제 데이터 물리 삭제.
- 운영 DB 접속 정보 Git 커밋.

## 로컬 개발 순서

1. `.env.example`을 참고해 로컬 `.env`를 만듭니다.
2. 로컬 PostgreSQL DB를 준비합니다.
3. schema 문법을 확인합니다.

```bash
npm run db:validate
```

4. Prisma Client를 생성합니다.

```bash
npm run db:generate
```

5. 로컬 DB에만 migration을 실행합니다.

```bash
npm run db:migrate:dev
```

## 운영 DB migration 규칙

운영 DB migration 전에는 반드시 아래를 확인합니다.

- 사용자가 운영 DB 백업 확인 여부를 명시했는가?
- 사용자가 migration 실행 범위를 명시했는가?
- 테스트 DB 또는 로컬 DB에서 migration을 먼저 실행했는가?
- rollback 또는 복구 절차가 있는가?

Claude Code는 사용자가 백업 확인 여부와 실행 범위를 명시하지 않은 상태에서 운영 migration을 실행하면 안 됩니다.

참고: Prisma 7에서는 연결 URL을 `schema.prisma`에 쓰지 않고 `prisma.config.ts`에서 관리합니다. 현재 scaffold는 `DATABASE_URL`을 사용합니다. `DIRECT_URL`은 배포/연결 구조상 별도 직접 연결이 필요할 때만 사용합니다.

## Coolify 환경변수 주의

배포 실행은 저장소 관리자가 직접 수행합니다. 이 저장소에는 배포 절차 대신 앱이 깨지지 않기 위한 환경변수 규칙만 남깁니다.

- `DATABASE_URL`은 Coolify secret/env로만 관리하고 Git에 커밋하지 않습니다.
- `DATABASE_URL`, `OPERATION_DATA_SOURCE`, `NODE_ENV`는 런타임에만 적용합니다.
- Coolify에서 SSH 없이 migration을 적용해야 하면 `RUN_DB_MIGRATIONS=true`를 런타임 환경변수로 켜고 재배포합니다.
- `RUN_DB_MIGRATIONS=true`는 컨테이너 시작 전에 `prisma migrate deploy`를 실행합니다.
- Coolify에서 `NODE_ENV=production`의 `Available at Buildtime`은 끕니다.
- buildtime에 `NODE_ENV=production`이 들어가면 `npm ci`가 devDependencies를 생략해 TypeScript/빌드 도구가 빠질 수 있습니다.

## Drive 조회 이력 저장

Drive import 후보 검색/조회는 표준 운영 데이터를 바로 수정하지 않고 별도 이력 테이블에 저장합니다.

- 실행 단위 요약은 `drive_import_runs`에 저장합니다.
- 운영 건별 검색/스캔 결과는 `drive_import_results`에 저장합니다.
- `drive_import_results.key_candidates`에는 Drive 링크, 강의관리 링크, 결과보고서 링크, 만족도, 강사명 등 주요 후보를 JSON으로 보존합니다.
- `drive_import_results.folder_candidates`에는 폴더 URL이 없는 운영 건에서 찾은 상위 폴더 후보를 JSON으로 보존합니다.

로컬 또는 Coolify 컨테이너에서 읽기 전용 드라이런을 실행합니다.

```bash
npm run drive:import:dry-run
```

일부 건만 검증할 때는 제한을 둡니다.

```bash
npm run drive:import:dry-run -- --limit 10 --concurrency 2
```

Coolify DB에 저장하려면 Coolify 앱 컨테이너 안에서 실행해야 합니다.
이때 컨테이너의 `DATABASE_URL`은 Coolify secret/env의 운영 DB를 가리켜야 합니다.
마이그레이션이 아직 적용되지 않았다면 먼저 `RUN_DB_MIGRATIONS=true`로 재배포하거나 컨테이너에서 아래 명령을 실행합니다.

```bash
npm run db:migrate:deploy
```

주의: 이 드라이런은 Drive와 DB를 읽고 `drive_import_*` 테이블에 이력을 쓰지만, `operation_sessions`의 표준 운영 필드는 변경하지 않습니다.

## 원천 수집/적재 규칙

- 기존 엑셀/시트 원천 파일, Gmail 원문, 외부 시스템 데이터는 직접 수정하지 않습니다.
- 원천 적재 실행 이력은 `data_import_runs`에 남깁니다.
- 원천 행 snapshot과 미매핑 필드는 `operation_source_records`에 남깁니다.
- 운영 차수 중복 방지는 `source_fingerprint`를 사용합니다.
- 원천 행은 `operation_source_records.row_snapshot`으로 보존합니다.
- 검증 실패, 매칭 충돌, 필수값 누락은 `validation_errors`에 남깁니다.
- 개발 DB 샘플 데이터 단계에서는 reset/reimport를 허용합니다.
- 운영 DB 또는 운영 전환 이후에는 사람이 보강한 표준 운영 필드를 자동으로 덮어쓰지 않습니다.

## 원천 적재 코드 관리

실제 원천 파일명, 원천 행 예시, 고객사명, 담당자명, 금액, 링크, 파일명은 공개 저장소에 남기지 않습니다.

원천 적재 adapter가 필요하면 비공개 저장소 또는 보안이 설정된 작업 공간에서 관리합니다. 공개 저장소에는 adapter 실행 규칙과 DB 쓰기 안전 규칙만 남깁니다.

읽기 전용 연동 계약은 [source-read-contract.md](source-read-contract.md)를 따릅니다. MVP에서는 외부 원천에 쓰지 않고 읽기 결과를 표준 운영 데이터로 매핑하는 것부터 검증합니다.

## PR에 반드시 적을 것

- migration 포함 여부.
- 운영 DB write 포함 여부.
- import/write-back 포함 여부.
- 백업 필요 여부.
- 실행한 DB 검증 명령.
- 실행하지 않은 검증과 이유.
