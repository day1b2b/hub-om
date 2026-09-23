# 실행 및 검증 보고

## 결과
후속 구현 범위는 DB 없이 검증 완료. 원래 목표인 개인정보 전체 저장 보호/운영 전환은 미완료이며 머지 차단.
- PR #599 확인: OPEN/DRAFT, dev 대상, 원본 1e7941c50ff92b0083836b6112b64afb8a3bc3de.
- origin/dev 06b025c578117f55d8b70171c92c5cdce9454da3를 후속 브랜치에 로컬 통합(4a46b7b). 원격 merge/push 없음.
- 저장소 AGENTS.md는 없음. 사용자 제공 AGENTS 지침과 CLAUDE.md/필수 문서/manager-ai-workflow를 읽음.

## 재현 및 수정
1. 부분검색은 테이블 전체를 읽어 총 20,001행이면 후보 2행인 업무 조회도 실패하는 코드 경로. fixture에서 총 20,003행/활성2행 검색 결과1행으로 회귀 고정. 상한 20,000 유지.
2. 이름 정렬은 전체 payload를 먼저 복호화하는 경로. root 조회는 키 projection 후 RepeatableRead 내 선택 페이지 재조회, 20,001행/32MiB 초과는 복호화 전 오류. byte cap은 수신 후 검사여서 전체 메모리 상한이 아님.
3. 독립 검토 P1: undefined/빈 AND가 OR 후보를 잘못 좁힐 위험. 빈 조건 정규화 및 반환 결과 검증 추가.
4. 독립 검토 P2: 기존 callback transaction에서 두 단계 조회 일관성 위험. root만 두 단계 최적화하고 기존 callback transaction은 단일 payload 조회 유지. 격리 수준 변경 없음.
5. team-members.json 평문 읽기 누락. 암호화 읽기/파일 변환 목적 추가, ENOENT만 fallback.
6. 최신 dev resultReportNeeded 미분류 및 OM 요청 활동 trigger 정책 불일치. 분류 추가, 후속 migration(실행 안 함), 보호 필드↔audit 값 목록 회귀 추가. 전체 테스트 최초 1실패를 실제 확인 후 해소.
7. 코치 접근 토큰 백필 SQL 차단. 암호화 repository로 전환, fixture로 blind index/복호화/암호문 update 검증. 나머지 CLI 차단 유지.

## 검증 명령과 결과
- npm ci --ignore-scripts --no-audit --no-fund: 기존 lock의 519개 설치. lock 변경/새 의존성 없음.
- npm run db:generate, npm run db:validate: 폐쇄 로컬 포트의 더미 URL을 지정, schema generate/validate만 실행. DB 접속 없음.
- npm run typecheck: 통과.
- npm run lint: 오류0, 기존 경고7. 신규 경고 없음.
- npm test: DB 연결/통합테스트 URL 환경변수를 제거하여 실행. 최종 528개/통과524/실패0/skip4.
- npm run build: DB 환경변수 제거, 통과, 모든 앱 경로 동적 렌더링.
- git diff --check: 통과.
- 개인정보 검색/정렬 전용10개, CLI 전용7개, 직원파일+파일변환8개 통과. 전체테스트에 포함.

## Validation v2 판정
3범주 15개 모두 이번 코드 범위에서 충족하되 DB 의미·성능·화면 검증은 제외한다.
- 정확성 5: 업무 후보 축소, AND, OR 빈 분기, NOT, 복합 조건은 database.test.ts 실제 where 평가/평문 기대 ID 비교.
- 보안5: projection 및 HMAC 쿼리 검증, 20,000/20,001/32MiB 오류, 상한 유지, 암호문 query/파일 fail-closed. 모든 쿼리 언어를 흉내 낸 mock은 아니며 실제 Prisma/SQL 동등성은 미검증.
- 회귀5: 반환값 검증, 문자열/null 경계, skip/take/PK projection/동률/callback transaction, CLI dry-run/암호화 및 fixture rollback, 미검증 구분.

## 미실행
로컬·운영 DB 시작/접속, migration 적용, 실제 백필·복구·키 교체, 기존 사용자 파일, 화면 실행, Coolify/배포, 원격 push/merge. DB 테스트 4개는 개인정보/활동로그/과정명 복원/캘린더 잠금.

## 범위 적합성
Level3 적절: 실제 통합 회귀와 후보 조건/트랜잭션 반례를 발견. 불필요한 제품/스키마 확장 대신 상한/동작을 보존. 브라우저 정책은 사용자 최종 결정에 따라 기존 저장 위치/localStorage/보존/복구 동작 유지. 후속 커밋은 문서만 갱신했으며 원본 PR 대비 관련 3파일 diff 없음으로 변경하지 않았음을 확인했다. 다른 계정의 초안 접근 차단 및 오프라인 암호화·키 관리는 미검증이며 전체 암호화 완료로 표현하지 않는다. 다음 작업은 책임자 정책 결정 및 승인된 격리 DB 검증.
