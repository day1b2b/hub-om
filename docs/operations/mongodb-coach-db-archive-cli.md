# 코치 DB 아카이브 CLI Mongo 경계

## 범위

`db:archive:coach-db`는 외부 coach-db의 `public` base table 전체를 읽어 `CoachdbArchiveSnapshot`과 `CoachdbArchiveRow`에 보관한다. 기본 target은 암호화 PostgreSQL이고 exact `--backend=mongodb-shadow`만 이미 준비된 Mongo shadow namespace를 사용한다. source는 항상 PostgreSQL 읽기 전용 연결이다.

```bash
npm run db:archive:coach-db -- --dry-run
npm run db:archive:coach-db -- --apply
npm run db:archive:coach-db -- --backend=mongodb-shadow --dry-run
```

## 안전 계약

- source 연결은 session 기본값과 transaction 모두 `REPEATABLE READ READ ONLY`이며 연결 5초, statement/idle 120초 제한을 둔다.
- dry-run은 테이블별 count만 읽고 target에 쓰지 않는다. apply는 같은 source snapshot에서 행을 읽는다.
- PK가 있으면 기존 PostgreSQL `::text` 연결 키, 없으면 기존 `md5(row_to_json(t)::text)` 키를 유지한다.
- 중복 row key나 읽은 건수 불일치는 전체 실패한다. 기존 배치 간 덮어쓰기로 summary와 저장 건수가 달라질 수 있던 동작을 안전하게 차단한다.
- target은 snapshot·전체 row·completed 갱신을 한 transaction으로 확정한다. 실패한 부분 snapshot은 남기지 않는다. 재실행은 새 completed snapshot을 만든다.
- `rowKey`와 `rowData`는 privacy wrapper 또는 Mongo codec으로 암호화되고 HMAC companion unique를 사용한다.
- source 식별자는 연결 URL을 저장하지 않고 고정값 `configured-postgresql-source`만 저장한다. 오류 원문도 출력하지 않는다.
- 알 수 없는 인자와 `--dry-run`/`--apply` 혼용을 거부한다.
- Mongo CLI는 collection·validator·index를 자동 생성·수리하지 않으며 부분 namespace에서 실패한다.

## 현재 검증과 한계

합성 PostgreSQL 17 source/target과 MongoDB 8.0.30 replica set에서 dry-run 무쓰기, apply 반복 새 snapshot, 암호문/HMAC 저장, 중복 키 후반 실패 전체 rollback을 각각 1 pass로 확인했다. command/CLI 3 pass, 일반 회귀 1,134 pass/123 opt-in skip/0 fail, typecheck/build 통과, lint 오류 0·기존 경고 7이며 독립 최종 리뷰에서 잔여 P0–P3가 없었다. 실제 운영 source·Atlas·운영 키에는 접근하지 않았다.

현재 구현은 기존 스크립트와 같이 apply 입력을 메모리에 고정한 뒤 target transaction에 전달한다. 따라서 매우 큰 운영 원천의 메모리·Mongo transaction 크기/시간은 실제 복사 리허설 전에 별도 용량 측정이 필요하다. commit 응답이 불명확하면 성공이나 rollback으로 단정하지 않고 검증 CLI로 새 completed snapshot을 대조해야 한다. 이 단위는 아카이브 CLI 경계이며 독립 A/B 백업, 복원, 실데이터 복사와 최종 전환을 완료하지 않는다.
