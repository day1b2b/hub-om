# 만족도 CSV 드라이런 Mongo 경계

## 범위

`satisfaction:dry-run`은 승인된 로컬 CSV를 운영 목록과 매칭하는 읽기 전용 점검 도구다. 기본 저장소는 개인정보 암호화 wrapper가 적용된 PostgreSQL이며, exact `--backend=mongodb-shadow`만 이미 준비된 Mongo namespace를 연다.

```bash
npm run satisfaction:dry-run -- --csv=.local/eduops-log.csv
npm run satisfaction:dry-run -- --csv=.local/eduops-log.csv --limit=100 --backend=mongodb-shadow
```

Mongo 경로는 collection·validator·index·counter를 생성하거나 수리하지 않는다. 입력 CSV는 32MiB, 표시 건수는 1~10,000으로 제한한다.

## 동작과 개인정보

- 기존 CSV 헤더 해석, 날짜·강사명·만족도 정규화와 `matchSatisfactionRow`의 matched/ambiguous/unmatched 판정을 그대로 사용한다. 기존 CLI와 같이 후보의 `courseId`는 매칭 근거로 추가하지 않는다.
- 운영 후보는 `OperationRepository.listOperations()`에서 읽는다. PostgreSQL은 암호화 wrapper를 거쳐 복호화하고 Mongo는 runtime codec으로 복호화한다.
- 저장 데이터와 오류 메시지에는 이름·CSV 행·파일 경로를 추가로 남기지 않는다. 실행자가 요청한 표 결과에는 기존 도구와 같이 복호화된 과정명·강사명·매칭 식별자를 표시한다.
- 도구는 operation·감사·CSV에 쓰지 않는다. 외부 Google Sheets도 호출하지 않는다.

## 적용 전 확인

이 도구는 보관된 수동 점검 기능이며 production backend 선택이나 만족도 기능 재활성화를 수행하지 않는다. 운영 실행 전 승인된 CSV와 읽기 권한, 개인정보가 남을 수 있는 터미널 출력 보관 정책을 확인한다. Mongo 검증은 실제 복사·validator/index 준비가 끝난 별도 shadow namespace에서만 실행한다.

## 검증과 한계

- command/runtime 단위 5 pass, 실제 PostgreSQL 17·MongoDB 8.0.30 대조 1 root pass
- 암호화 PostgreSQL package launcher에서 1건 매칭과 조회 전후 operation/activity 건수 불변 확인
- 실제 두 저장소에서 동일 matched 집계와 Mongo 전체 collection snapshot 불변 확인
- 전체 회귀 1,162 pass / 133 opt-in skip / 0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7. 독립 리뷰 결과는 `.claude/plans/mongodb-satisfaction-dry-run-cli/`를 따른다.
- 실제 운영 CSV·DB·Atlas·Google·키·배포 설정에는 접근하지 않았다. 운영 규모와 실제 승인 출력 보관 절차는 미검증이다.

이 범위는 수동 만족도 CSV 드라이런 한 개의 읽기 경계다. 보관 기능 재활성화, production selector, 실제 A/B 백업·복원·복사·최종 전환과 `dev → main`은 완료되지 않았다.
