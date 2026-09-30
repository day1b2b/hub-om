# 코치 데이터 검증 CLI Mongo 경계

## 범위

`db:verify:coach-data`는 서비스 코치 데이터, 최근 import, 최근 coach-db 아카이브와 주요 테이블 건수를 읽어 비교한다. 기본 저장소는 암호화 PostgreSQL이고 exact `--backend=mongodb-shadow`만 이미 준비된 Mongo shadow namespace를 연다. 이 도구는 데이터를 생성·수정·삭제하지 않는다.

```bash
npm run db:verify:coach-data
npm run db:verify:coach-data -- --backend=mongodb-shadow
```

Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하다. CLI는 collection·validator·index를 생성하거나 수리하지 않고 준비 계약이 다르면 실패한다. PostgreSQL은 repeatable-read transaction을 명시적으로 read-only로 설정하고, Mongo는 snapshot transaction에서 순차 조회한다.

## 출력과 원천 규칙

- 서비스는 전체/활성/삭제 코치, 비공개 프로필, 투입, 일정, 투입 일정, 운영 연결 여부의 건수만 출력한다.
- 최근 import와 최근 아카이브는 상태·건수·완료 시각만 출력한다. 아카이브 ID, 오류·메모·개인정보 값은 출력하지 않는다.
- 최신 아카이브의 `coaches`, `coach_private_profiles`, `engagements`, `coach_schedules`, `engagement_schedules` 건수와 서비스 건수를 비교한다.
- `COACH_DB_DATABASE_URL`이 있으면 원본 네 테이블의 live count를 추가로 읽는다. 이 연결은 session 기본값과 transaction을 모두 read-only로 강제하고 30초 statement/idle 제한을 둔다.
- 저장소·원천 오류는 고정 오류로 바꾸며 연결 문자열이나 원문 오류를 출력하지 않는다.

## 검증과 한계

- 일반 회귀: 1,131 pass / 121 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 pass(snapshot count, 개인정보 비노출, command 무쓰기, 부분 namespace 무수정 거부)
- 실제 합성 PostgreSQL 17: 1 pass(암호화 저장, target read-only transaction, 별도 source 강제 read-only와 건수 비교)
- 동일 fixture PostgreSQL↔Mongo parity: 1 pass(전체 보고서와 최신 시각 동률 정렬 대조)
- command/CLI 단위: 2 pass
- typecheck/build 통과
- lint: 오류 0, 기존 경고 7
- 실제 PG와 parity는 서로 다른 전용 DB에서 동시 실행해 2 pass/0 fail을 확인했고, 독립 최종 리뷰에서 잔여 P0–P3가 없었다.

운영 DB·Atlas·실제 coach-db 원천·운영 키·배포 설정에는 접근하지 않았다. 이 범위는 한 검증 CLI의 읽기 경계이며 실제 아카이브·가져오기, 데이터 복사, 백업·각 복원 리허설, production selector와 최종 전환을 완료하지 않는다.
