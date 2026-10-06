# 팀원 파일 가져오기 CLI Mongo 경계

## 범위

`db:import:team-members`는 `local:team-members` 문맥으로 암호화된 `.local/team-members.json`을 읽어 팀원 명단을 적재한다. 기본 저장소는 암호화 PostgreSQL이며 exact `--backend=mongodb-shadow`만 이미 준비된 검증용 Mongo namespace를 연다.

```bash
npm run db:import:team-members -- --dry-run
npm run db:import:team-members -- --apply --backup-confirmed --maintenance-confirmed
npm run db:import:team-members -- --dry-run --backend=mongodb-shadow
```

확인 플래그는 백업이나 writer 중단을 수행하지 않는다. Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하며 정상 CLI는 collection·validator·index·guard를 생성하거나 수리하지 않는다.

## 기존 의미와 저장 규칙

- `OM`/`om`, `LD`/`ld`, `1팀`, `2팀`, `미분류`와 팀 누락을 기존과 같이 정규화한다. 이름 공백 제거·소문자 자연키와 유효하지 않은 이름/역할/팀 행 제외도 유지한다.
- 입력에 나타난 `(role, sourceTeam)` 그룹만 동기화한다. 그룹 안에서 파일에 없는 활성 행은 비활성화하고 다른 그룹은 바꾸지 않는다. 원문 이름·직책·캘린더 ID는 결과와 오류에 출력하지 않는다.
- PostgreSQL은 개인정보 wrapper의 암호문과 HMAC companion으로 조회·저장한다. `sourceTeam=null`에서는 SQL unique가 중복을 막지 못하므로 원문 자연키 조건에 맞는 기존 행을 모두 갱신한다. 직렬화 충돌 `P2034`는 전체 transaction을 최대 5회 재시도한다.
- Mongo는 authenticated codec, `(role, sourceTeam, normalizedNamePiiIndex)` unique index와 전용 import guard를 사용한다. guard는 동시 import를 직렬화하고, 관리자 셀 수정은 같은 Member 문서의 transaction 충돌로 다시 읽는다. 최초 guard upsert의 duplicate key는 전체 transaction을 최대 5회 재시도한다.
- dry-run은 저장·guard 갱신 없이 신규/갱신/비활성 예상 건수만 계산한다. apply는 전체 파일을 한 transaction으로 처리하며 후반 실패 시 앞선 변경도 롤백한다.
- 4MiB·20,000개 상한, strict 인자와 apply의 백업·점검 모드 확인을 적용한다. 기존 shadow 계약이 다르면 자동 변환·삭제하지 않고 새 run ID/namespace 재복사를 우선한다.
- 기본 PostgreSQL은 기존과 같이 localhost·loopback만 허용한다. 비로컬 대상은 별도 운영 확인 뒤 `ALLOW_NON_LOCAL_TEAM_MEMBER_IMPORT=true`를 명시해야 하며, 확인 플래그만으로 이 gate를 우회할 수 없다.

## 적용과 복구 순서

1. PostgreSQL과 대상 Mongo의 독립 백업·격리 복원을 확인하고 팀원 파일 writer 및 관리자 Member 수정을 점검 모드로 전환한다.
2. 암호화 원천 파일과 키를 확인한 뒤 PostgreSQL dry-run 결과를 기록한다. Mongo 전환 검증이면 새 namespace 복사와 validator/index/guard 준비를 별도 절차로 완료한다.
3. apply를 한 번 실행하고 같은 명령을 재실행해 신규 0과 예상 갱신·비활성 건수를 확인한다. 저장 원문 비노출과 역할별 실제 조회 결과를 함께 대조한다.
4. 실패하면 transaction rollback 상태를 확인한다. 적용 후 업무 검증이 실패하면 writer를 계속 중단한 채 각 저장소 백업을 별도로 복원하고, 부분 실행 namespace를 자동 수리하지 않는다.

## 검증과 한계

- 일반 회귀: 1,143 pass / 128 opt-in skip / 0 fail
- 실제 PostgreSQL 17과 MongoDB 8.0.30 replica set: 각 1 root pass
- command/runtime 단위: 5 pass, 동결 Sheets/Notion 원본 대조: 60 pass
- PostgreSQL·Mongo CLI 프로세스와 package launcher 실행 통과
- typecheck/build 통과, lint 오류 0·기존 경고 7
- 독립 첫 리뷰의 비로컬 PostgreSQL gate P1과 재리뷰의 nullable 팀 Mongo 중복 P2를 보완했으며, 최종 재리뷰는 잔여 P0~P3 없이 통과했다.
- 실제 DB 검증은 dry-run 무쓰기, 암호화 저장/HMAC 조회, 신규·갱신·그룹별 비활성, `sourceTeam=null` legacy 중복, 재실행, 후반 실패 rollback, Mongo 동시 import와 부분 namespace 무수정 거부를 포함한다.
- 실제 `.local` 파일·운영 DB·Atlas·운영 키·배포 설정에는 접근하지 않았다. 강제 PostgreSQL `P2034` 발생, 관리자 셀 수정과 import의 실제 barrier 경합, 운영 규모는 별도 미검증이다.

이 범위는 팀원 가져오기 CLI 하나의 저장소 경계다. `promote-source-only`의 기존 팀 전체·여러 import run 의미와 현재 단일 run 승격 계층의 차이는 별도 호환성 작업으로 남는다. 전체 앱 조립, 실제 A/B 백업·각 복원·실데이터 복사·최종 전환과 `dev → main`은 완료되지 않았다.
