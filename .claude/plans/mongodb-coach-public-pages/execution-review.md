# Execution Review: mongodb-coach-public-pages

기준 SHA는 `be365693e2371362e6e4746a7a4f9c7564390f83`이며 운영 데이터·실원천·운영 키·배포 설정을 사용하지 않았다. Node 24.19.0, `TZ=Asia/Seoul`, 새 loopback MongoDB 8.0.30 replica set와 임시 암호화 키를 사용했다.

## 구현 결과

- `DataRepositories`에 `coach` port를 추가했다.
- `getCoachRepository()`는 명시 scope를 먼저 선택하고, scope 밖에서만 기존 `DATABASE_URL` guard와 `PrismaCoachRepository`를 사용한다.
- 기존 7개 page와 페이지 업무 로직은 수정하지 않았다.
- Google Drive=A, OneDrive=B 후보와 아직 남은 실증 gate를 문서화했다.
- package/lockfile, Prisma schema, 신규 업무 필드, 삭제 정책 변경은 0이다.

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| actual Mongo factory·7페이지 | 12 PASS / 0 skip / 0 fail |
| 기존 `MongoCoachRepository` native | 1 PASS / 0 skip / 0 fail |
| 일반 테스트 | 1083 PASS / 100 opt-in skip / 0 fail |
| typecheck | PASS |
| lint | 오류 0, 기존 경고 7 |
| production build | PASS |

actual Mongo 검사는 auth 선행, 기본 PG guard, scope 누락 fail-closed, 일정 오류 위치, 상세 notFound 후 후속0, 위키 동명이름 규칙, 운영 옵션 정렬, 동시 namespace 격리를 확인했다. Mongo 조회 구간 write command 0, PG 접근 0, 실외부 접근 0, 저장 fixture 개인정보 평문 0이었다. UI leaf와 비-coach repository·holiday·collaboration IO는 합성 seam이며 전체 앱 native 조립 증거가 아니다.

독립 리뷰의 P2에 따라 factory 원문을 별도 계측해 `DATABASE_URL` 읽기, override 호출, Prisma adapter 생성을 분리했다. scoped 정상 경로는 각각 0/1/0이며, 기본 PG 경로는 1/1/1, URL 누락은 1/1/0이다. scope 선택 전에 env를 읽거나 Prisma adapter를 생성하도록 변형한 두 음성대조는 모두 의도대로 실패했다. 보완 후 focused 12 PASS와 typecheck·해당 파일 lint를 재실행했다.

`PrismaCoachRepository`의 조회 메서드는 query 전에 공통 `getPrismaClient()`를 호출한다. 테스트는 이 진입점을 반환 없이 throw하는 tripwire로 대체하므로 호출0이면 실제 Prisma client 생성과 query도 불가능하다. scoped adapter 생성0과 getter 진입0을 함께 사용해 PG client/query 0을 판정했으며, getter 호출을 화면 catch가 삼키는 음성대조는 외부 ledger에서 실패한다.

## 실패와 보완

첫 전체 테스트 명령은 지정 Node 번들에 `npm` 실행 파일이 없어 exit 127이었다. 같은 Node 24.19.0으로 `/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js`를 실행해 전체 검사를 완료했다. 코드·테스트 실패는 없었다.

## 미검증

- 운영 PostgreSQL·운영 Mongo·실사용 개인정보와 실원천
- 전체 Next 서버의 생산 backend 조립과 배포
- Google Drive/OneDrive 실제 계정·용량·retention·암호화·독립 권한
- 실제 A/B 업로드 무결성, 키 회수, 각각의 격리 복원
- 운영 collation/TZ, 실제 데이터 복사·최종 동기화·전환·rollback

위 항목은 PASS가 아니며 운영 전환을 계속 차단한다.

## 합성 자원 정리

테스트 DB drop 후 `admin`, `config`, `local`만 남은 것을 확인했다. 소유 PID 61677을 종료하고 포트 27860 폐쇄, `/private/tmp/hub-om-coach-public-pages-20260930` 삭제를 확인했다. 다른 프로세스·dbpath는 건드리지 않았다.
