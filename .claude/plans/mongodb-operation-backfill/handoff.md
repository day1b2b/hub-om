# 운영 보정 인계

격리 clone: `/Users/ga/workspace/hub-om-mongodb-coach-content`
기능 브랜치: `feature/20260929-mongodb-operation-backfill`
기준 총괄 SHA: `118e2763678db0a210715e479c5ce3baa06f77d1`.

## 완료한 범위

기존 onsite-required-backfill 및 om-assignment-status-backfill GET/POST를 별도 repository로 전환했다. 기본은 PG이며 명시 operationBackfill context에서만 Mongo를 사용한다. 기존 exact 조건·목표 값·권한·응답·POST body 미사용을 유지했다. 한 업무 필드와 updatedAt만 변경하고 비관련 raw 암호문·관계를 보존한다. 변경 감사는 같은 transaction에 기록한다. console의 관리자 이메일 평문을 제거하고 고정 도구명·건수만 남긴다.

## 검증

Node24.19.0, env-i, 새 PG17.9의 45개 migration 및 Mongo8.0.30 replica set. 합성자료·임시키만 사용했다.

- 일반 890pass / 39skip / 0fail. opt-in skip은 PASS가 아니다.
- PG 원본 query/new PG/native Mongo 및 실제 handler/factory: 11pass / 0skip / 0fail, exit0.
- 전체 Mongo 회귀: 322pass / 0skip / 0fail / 0cancelled, exit0. 신규 native36·handler6·mock4 포함. 위11과 중복 합산하지 않는다.
- typecheck/build PASS, lint 오류0·기존 경고7.
- Gibbs 독립 최종 V1–V10 수락 PASS, 남은 P0–P3 코드 지적 없음.

실행 근거·가상 시계 및 20k 경계 별도 미실행 등의 한계는 execution-review.md를 따른다. 실OAuth·브라우저 E2E·운영 부하·실데이터·원천·복구 리허설·운영 전환은 검증하지 않았다. 검증 후 코드 변경은 없고 문서만 갱신했다.

## 자원·통합

소유 runtime `/private/tmp/hub-om-operation-backfill-20260929`의 PG56639/Mongo27739를 정상 종료했다. 남은 합성 DB0, 소유 dbpath 두 개 제거와 부재, cleanup exit0 확인. 로그/실행스크립트만 보존했다. 기능 push와 총괄 통합 SHA는 후속 integration-review.md 및 원격 ref와 대조한다.

## 다음 후보와 전체 상태

다음 관리자 단위 후보는 `courseNameRestore.ts`와 `/api/admin/course-name-restore`의 미리보기·선택 복원이다. 사용처를 읽기 전용으로 확인했다. 원천 기록의 최신 시각 동률·대상 과정 중복·메타데이터 충돌 차단, snapshot 재검증, 1~100개 선택, 과정 생성/회차 이동/감사 원자성을 별도 계획으로 다뤄야 한다. 아직 새 브랜치나 코드는 만들지 않았다.

관리자 DB 호스트/셀, 기존 onsite legacy PG CLI, 가져오기·OM 접수·배정·캘린더·공지 등 coverage의 다른 미전환 경로와 실제 데이터 복사·복구 리허설·최종 전환은 남아 있다. 브라우저 초안 암호화와 전체 앱 전환도 완료로 표현하지 않는다. 운영/원본 workspace/키/env/권한/배포 및 main/dev는 변경하지 않았고 자동화를 재개하지 않았다. 전체 완료 조건이 충족되지 않았으므로 dev→main도 아직 진행하지 않았다.

기능 commit `ba46c0d0b8be897b5ee2530f0460cad92903d777` 원격 일치 및 총괄 fast-forward 통합을 확인했다. 코드 동일성과 통합 근거는 integration-review.md에 기록했다.
